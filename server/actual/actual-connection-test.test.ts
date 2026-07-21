import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));
const mockDecrypt = vi.hoisted(() => vi.fn((value) => `decrypted:${value}`));

vi.mock("../db/connection.ts", () => ({ default: mockDb }));
vi.mock("../platform/encryption.ts", () => ({ decrypt: mockDecrypt }));

const originalFetch = global.fetch;
const originalTimeout = process.env.EA_ACTUAL_TEST_TIMEOUT_MS;

beforeEach(() => {
  vi.resetModules();
  mockDb.execute.mockReset();
  mockDecrypt.mockClear();
  delete process.env.EA_ACTUAL_TEST_TIMEOUT_MS;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.EA_ACTUAL_TEST_TIMEOUT_MS = originalTimeout;
});

function settingsRow(row: Record<string, unknown> = {}): void {
  mockDb.execute.mockResolvedValueOnce({
    rows: [{
      actual_budget_url: "https://actual.example.com/",
      actual_budget_password_encrypted: "ciphertext",
      actual_budget_sync_id: "sync-123",
      ...row,
    }],
  });
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Pick<Response, "ok" | "status" | "text"> {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
  };
}

describe("testActualConnectionHttp", () => {
  it("validates hosted Actual auth and sync id without loading the SDK", async () => {
    settingsRow();
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", data: { token: "token-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        status: "ok",
        data: [{ groupId: "sync-123" }, { groupId: "sync-other" }],
      })) as unknown as typeof fetch;

    const { testActualConnectionHttp } = await import("./actual-connection-test.ts");
    const result = await testActualConnectionHttp("u1");

    expect(result).toEqual({ success: true, budgetCount: 2, budgetFound: true });
    expect(global.fetch).toHaveBeenNthCalledWith(1, "https://actual.example.com/account/login", expect.objectContaining({
      method: "POST",
      redirect: "manual",
      body: JSON.stringify({ password: "decrypted:ciphertext", loginMethod: "password" }),
    }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, "https://actual.example.com/sync/list-user-files", expect.objectContaining({
      redirect: "manual",
      headers: expect.objectContaining({ "X-ACTUAL-TOKEN": "token-1" }),
    }));
  });

  it("refuses to send the stored password to a changed override URL", async () => {
    settingsRow({ actual_budget_url: "https://stored.example.com" });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { testActualConnectionHttp } = await import("./actual-connection-test.ts");
    await expect(testActualConnectionHttp("u1", {
      serverURL: "https://override.example.com/",
      syncId: "override-sync",
    })).rejects.toMatchObject({
      code: "ACTUAL_PASSWORD_REQUIRED_FOR_SERVER_CHANGE",
      status: 400,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("may reuse the stored password when the normalized override URL is unchanged", async () => {
    settingsRow({ actual_budget_url: "https://stored.example.com/actual/" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", data: { token: "token-1" } }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", data: [{ groupId: "override-sync" }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { testActualConnectionHttp } = await import("./actual-connection-test.ts");
    const result = await testActualConnectionHttp("u1", {
      serverURL: "https://stored.example.com/actual",
      syncId: "override-sync",
    });

    expect(result.budgetFound).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://stored.example.com/actual/account/login");
    expect(fetchMock.mock.calls[0]![1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ password: "decrypted:ciphertext", loginMethod: "password" }),
    }));
  });

  it("does not reflect or log the remote error reason (SEC-05)", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    settingsRow();
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "error", reason: "internal-banner-xyz" })) as unknown as typeof fetch;

    const { testActualConnectionHttp } = await import("./actual-connection-test.ts");

    let caught: unknown = null;
    try {
      await testActualConnectionHttp("u1");
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("internal-banner-xyz");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("internal-banner-xyz");
  });

  it("fails fast when the hosted Actual server stalls", async () => {
    settingsRow();
    process.env.EA_ACTUAL_TEST_TIMEOUT_MS = "1";
    global.fetch = vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    })) as unknown as typeof fetch;

    const { testActualConnectionHttp } = await import("./actual-connection-test.ts");

    await expect(testActualConnectionHttp("u1")).rejects.toMatchObject({
      status: 502,
      message: "Actual Budget connection test timed out",
    });
  });
});
