import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
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
      actual_budget_sync_id TEXT,
      actual_budget_encryption_password_encrypted TEXT
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

    expect(result).toEqual({ success: true, budgetCount: 2, budgetFound: true, budgetEncrypted: false });
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

// The same derivation Actual uses for its key test: PBKDF2-SHA512 over the
// password and server salt, then AES-256-GCM over a random test payload.
function actualKeyTest(password: string) {
  const salt = randomBytes(32).toString("base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", pbkdf2Sync(password, salt, 10_000, 32, "sha512"), iv);
  const value = Buffer.concat([cipher.update(randomBytes(32)), cipher.final()]);
  const test = JSON.stringify({ value: value.toString("base64"), meta: { algorithm: "aes-256-gcm", iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") } });
  return { status: "ok", data: { id: "key-1", salt, test } };
}

describe("end-to-end encrypted budgets", () => {
  const encryptedFetch = (keyTest = actualKeyTest("budget-key")) => vi.fn()
    .mockResolvedValueOnce(jsonResponse({ status: "ok", data: { token: "token-1" } }))
    .mockResolvedValueOnce(jsonResponse({ status: "ok", data: [{ groupId: "sync-123", fileId: "file-1", encryptKeyId: "key-1" }] }))
    .mockResolvedValueOnce(jsonResponse(keyTest)) as unknown as typeof fetch;
  const overrides = (encryptionPassword?: string | null) => ({
    serverURL: "https://actual.example.com", syncId: "sync-123", password: "server",
    ...(encryptionPassword === undefined ? {} : { encryptionPassword }),
  });

  it("verifies the encryption password against the server key test before reporting success", async () => {
    await expect(testActualConnectionHttp("u1", overrides("budget-key"), dependencies(encryptedFetch())))
      .resolves.toEqual({ success: true, budgetCount: 1, budgetFound: true, budgetEncrypted: true });
  });

  it("rejects an incorrect encryption password", async () => {
    await expect(testActualConnectionHttp("u1", overrides("wrong-key"), dependencies(encryptedFetch())))
      .rejects.toMatchObject({ status: 400, code: "ACTUAL_ENCRYPTION_PASSWORD_INCORRECT" });
  });

  it("requires an encryption password, using the stored one when none is supplied", async () => {
    await expect(testActualConnectionHttp("u1", overrides(), dependencies(encryptedFetch())))
      .rejects.toMatchObject({ status: 400, code: "ACTUAL_ENCRYPTION_PASSWORD_REQUIRED" });
    await db.execute({
      sql: "INSERT INTO ea_settings (user_id, actual_budget_url, actual_budget_sync_id, actual_budget_encryption_password_encrypted) VALUES ('u1', ?, 'sync-123', 'stored')",
      args: ["https://actual.example.com"],
    });
    const stored = { ...dependencies(encryptedFetch(actualKeyTest("budget-key"))), decryptValue: () => "budget-key" };
    await expect(testActualConnectionHttp("u1", overrides(), stored)).resolves.toMatchObject({ budgetEncrypted: true });
  });
});
