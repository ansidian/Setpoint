import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testActualConnectionHttp } from "./actual-connection-test.ts";

const originalTimeout = process.env.EA_ACTUAL_TEST_TIMEOUT_MS;
let db: Client;

beforeEach(async () => {
  db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      actual_budget_url TEXT,
      actual_budget_password_encrypted TEXT,
      actual_budget_sync_id TEXT
    );
  `);
  delete process.env.EA_ACTUAL_TEST_TIMEOUT_MS;
});

afterEach(async () => {
  db.close();
  process.env.EA_ACTUAL_TEST_TIMEOUT_MS = originalTimeout;
});

async function settingsRow(row: Record<string, unknown> = {}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO ea_settings (
            user_id, actual_budget_url, actual_budget_password_encrypted, actual_budget_sync_id
          ) VALUES (?, ?, ?, ?)`,
    args: [
      "u1",
      String(row.actual_budget_url ?? "https://actual.example.com/"),
      String(row.actual_budget_password_encrypted ?? "ciphertext"),
      String(row.actual_budget_sync_id ?? "sync-123"),
    ],
  });
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Pick<Response, "ok" | "status" | "text"> {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
  };
}

const dependencies = (fetchFn: typeof fetch) => ({
  dbClient: db,
  decryptValue: (value: string) => `decrypted:${value}`,
  fetchFn,
});

describe("testActualConnectionHttp", () => {
  it("validates hosted Actual auth and sync id without loading the SDK", async () => {
    await settingsRow();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", data: { token: "token-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        status: "ok",
        data: [{ groupId: "sync-123" }, { groupId: "sync-other" }],
      })) as unknown as typeof fetch;

    const result = await testActualConnectionHttp("u1", null, dependencies(fetchFn));

    expect(result).toEqual({ success: true, budgetCount: 2, budgetFound: true });
    // test-architecture: allow-boundary-interaction -- Actual login is an outbound HTTP wire contract; the password placement and redirect policy are not observable in the normalized result.
    expect(fetchFn).toHaveBeenNthCalledWith(1, "https://actual.example.com/account/login", expect.objectContaining({
      method: "POST",
      redirect: "manual",
      body: JSON.stringify({ password: "decrypted:ciphertext", loginMethod: "password" }),
    }));
    // test-architecture: allow-boundary-interaction -- Actual file listing is an outbound HTTP wire contract; the session-token header cannot be inferred from the normalized result.
    expect(fetchFn).toHaveBeenNthCalledWith(2, "https://actual.example.com/sync/list-user-files", expect.objectContaining({
      redirect: "manual",
      headers: expect.objectContaining({ "X-ACTUAL-TOKEN": "token-1" }),
    }));
  });

  it("refuses to send the stored password to a changed override URL", async () => {
    await settingsRow({ actual_budget_url: "https://stored.example.com" });
    const fetchFn = vi.fn() as unknown as typeof fetch;

    await expect(testActualConnectionHttp("u1", {
      serverURL: "https://override.example.com/",
      syncId: "override-sync",
    }, dependencies(fetchFn))).rejects.toMatchObject({
      code: "ACTUAL_PASSWORD_REQUIRED_FOR_SERVER_CHANGE",
      status: 400,
    });

    // test-architecture: allow-boundary-interaction -- Fetch is the outbound Actual boundary; this uniquely proves a stored password is not exfiltrated to a changed server.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("may reuse the stored password when the normalized override URL is unchanged", async () => {
    await settingsRow({ actual_budget_url: "https://stored.example.com/actual/" });
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", data: { token: "token-1" } }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", data: [{ groupId: "override-sync" }] })) as unknown as typeof fetch;

    const result = await testActualConnectionHttp("u1", {
      serverURL: "https://stored.example.com/actual",
      syncId: "override-sync",
    }, dependencies(fetchFn));

    expect(result.budgetFound).toBe(true);
    // test-architecture: allow-boundary-interaction -- Actual login fetch is an outbound provider boundary; endpoint, credential payload, timeout signal, and redacted logging are observable only at that boundary.
    expect(vi.mocked(fetchFn).mock.calls[0]![0]).toBe("https://stored.example.com/actual/account/login");
    // test-architecture: allow-boundary-interaction -- Actual login fetch is an outbound provider boundary; endpoint, credential payload, timeout signal, and redacted logging are observable only at that boundary.
    expect(vi.mocked(fetchFn).mock.calls[0]![1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ password: "decrypted:ciphertext", loginMethod: "password" }),
    }));
  });

  it("does not reflect or log the remote error reason (SEC-05)", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await settingsRow();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "error", reason: "internal-banner-xyz" })) as unknown as typeof fetch;

    let caught: unknown = null;
    try {
      await testActualConnectionHttp("u1", null, dependencies(fetchFn));
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("internal-banner-xyz");
    // test-architecture: allow-boundary-interaction -- Actual login fetch is an outbound provider boundary; endpoint, credential payload, timeout signal, and redacted logging are observable only at that boundary.
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("internal-banner-xyz");
  });

  it("fails fast when the hosted Actual server stalls", async () => {
    await settingsRow();
    process.env.EA_ACTUAL_TEST_TIMEOUT_MS = "1";
    const fetchFn = vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    })) as unknown as typeof fetch;

    await expect(testActualConnectionHttp("u1", null, dependencies(fetchFn))).rejects.toMatchObject({
      status: 502,
      message: "Actual Budget connection test timed out",
    });
  });
});
