import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
} from "./test-utils/email-index-db.ts";
import type { Client, InStatement } from "@libsql/client";
import type { ConfiguredEmailAccount } from "./email-provider-types.ts";

// Mirror gmail-callback.test.ts: a real in-memory libsql DB behind the
// connection mock, and passthrough encryption so we can read/write the stored
// credentials JSON directly.
const testState = vi.hoisted((): {
  db: { current: Client | null };
  storedCredentials: { current: string | null };
} => ({
  db: { current: null },
  // decrypt() returns whatever JSON string the active test puts here.
  storedCredentials: { current: null },
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test DB was not initialized");
  return testState.db.current;
}

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => currentDb().execute(statement),
  },
}));
vi.mock("../platform/encryption.ts", () => ({
  decrypt: () => testState.storedCredentials.current,
  encrypt: (value: string) => value,
}));
const googleCredentials = vi.hoisted(() => ({
  resolveActive: vi.fn(async () => ({ clientId: "runtime-client-id", clientSecret: "runtime-client-secret" })),
}));
vi.mock("../google-oauth-credentials.ts", () => ({
  googleOAuthCredentialManager: googleCredentials,
}));

const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<unknown>>();
vi.stubGlobal("fetch", fetchMock);

const { getAccessToken } = await import("./gmail.ts");

describe("getValidToken expires_at handling (P3-48)", () => {
  beforeEach(async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedEmailAccount(currentDb(), {
      id: "gmail-work",
      type: "gmail",
      email: "work@example.com",
    });
    fetchMock.mockReset();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
    testState.storedCredentials.current = null;
  });

  async function readStoredCredentials() {
    const rows = await currentDb().execute({
      sql: "SELECT credentials_encrypted FROM ea_accounts WHERE id = ?",
      args: ["gmail-work"],
    });
    return JSON.parse(String(rows.rows[0]?.credentials_encrypted ?? "{}")) as Record<string, unknown>;
  }

  const account: ConfiguredEmailAccount = {
    id: "gmail-work",
    type: "gmail",
    email: "work@example.com",
    label: "Work",
    color: "#4285f4",
    credentials_encrypted: "stub",
  };

  it("refresh response with no expires_in yields a finite, future expires_at (default TTL)", async () => {
    // Stored token already expired so getValidToken triggers a refresh.
    testState.storedCredentials.current = JSON.stringify({
      access_token: "old",
      refresh_token: "rtok",
      expires_at: Date.now() - 1000,
    });
    // Refresh response intentionally omits expires_in.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "fresh" }),
    });

    const before = Date.now();
    const token = await getAccessToken(account);
    expect(token).toBe("fresh");

    const persisted = await readStoredCredentials();
    expect(Number.isFinite(persisted.expires_at)).toBe(true);
    expect(persisted.expires_at).toBeGreaterThan(before);
    // Default TTL is 3600s; allow slack for clock drift during the test.
    expect(persisted.expires_at).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
  });

  it("forces a refresh when the stored expires_at is non-finite, rather than treating it as valid", async () => {
    // A malformed credential whose expires_at is non-finite must not pass the
    // guard. With the old guard `expires_at < Date.now() + ...`, a non-numeric
    // value coerces to NaN and `NaN < anything` is false, so refresh is skipped
    // and every call 401s after the real token expires. The fix treats a
    // non-finite expires_at as already-expired and forces a refresh.
    testState.storedCredentials.current = JSON.stringify({
      access_token: "stale",
      refresh_token: "rtok",
      expires_at: "not-a-number", // non-finite: old guard would skip refresh
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "refreshed", expires_in: 3600 }),
    });

    const token = await getAccessToken(account);

    // A refresh actually happened: token swapped and exactly one fetch (the
    // refresh) was made.
    expect(token).toBe("refreshed");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://oauth2.googleapis.com/token");
    const refreshBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(String(refreshBody)).toContain("grant_type=refresh_token");

    const persisted = await readStoredCredentials();
    expect(persisted.access_token).toBe("refreshed");
    expect(Number.isFinite(persisted.expires_at)).toBe(true);
  });

  it("does not refresh when the stored token is still valid", async () => {
    testState.storedCredentials.current = JSON.stringify({
      access_token: "valid",
      refresh_token: "rtok",
      expires_at: Date.now() + 3600_000,
    });

    const token = await getAccessToken(account);

    expect(token).toBe("valid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token refresh request with an AbortSignal", async () => {
    testState.storedCredentials.current = JSON.stringify({
      access_token: "old",
      refresh_token: "rtok",
      expires_at: Date.now() - 1000,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "fresh", expires_in: 3600 }),
    });

    await getAccessToken(account);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("needs_reauth signaling on refresh (REL-01)", () => {
  beforeEach(async () => {
    testState.db.current = await createEmailIndexTestDb({
      extraMigrations: [
        "006_email_search_embedding_state.sql",
        "007_email_search_ai_usage.sql",
        "028_provider_needs_reauth.sql",
      ],
    });
    await seedEmailAccount(currentDb(), {
      id: "gmail-work",
      type: "gmail",
      email: "work@example.com",
    });
    fetchMock.mockReset();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
    testState.storedCredentials.current = null;
  });

  async function readNeedsReauth(accountId = "gmail-work") {
    const rows = await currentDb().execute({
      sql: "SELECT needs_reauth FROM ea_accounts WHERE id = ?",
      args: [accountId],
    });
    return rows.rows[0]?.needs_reauth;
  }

  const account: ConfiguredEmailAccount = {
    id: "gmail-work",
    type: "gmail",
    email: "work@example.com",
    label: "Work",
    color: "#4285f4",
    credentials_encrypted: "stub",
  };

  it("marks the account needs_reauth on an invalid_grant refresh failure, and still throws", async () => {
    testState.storedCredentials.current = JSON.stringify({
      access_token: "old",
      refresh_token: "rtok",
      expires_at: Date.now() - 1000,
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: async () => '{"error":"invalid_grant"}',
    });

    await expect(getAccessToken(account)).rejects.toThrow(/Token refresh failed/);

    expect(await readNeedsReauth()).toBe(1);
  });

  it("does not mark needs_reauth on a non-invalid_grant (429) refresh failure", async () => {
    testState.storedCredentials.current = JSON.stringify({
      access_token: "old",
      refresh_token: "rtok",
      expires_at: Date.now() - 1000,
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: async () => "Too Many Requests",
    });

    await expect(getAccessToken(account)).rejects.toThrow(/Token refresh failed/);

    expect(await readNeedsReauth()).toBe(0);
  });

  it("clears needs_reauth on a successful refresh for a previously flagged account", async () => {
    await currentDb().execute({
      sql: "UPDATE ea_accounts SET needs_reauth = 1 WHERE id = ?",
      args: ["gmail-work"],
    });
    testState.storedCredentials.current = JSON.stringify({
      access_token: "old",
      refresh_token: "rtok",
      expires_at: Date.now() - 1000,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "fresh", expires_in: 3600 }),
    });

    const flaggedAccount = { ...account, needs_reauth: 1 };
    const token = await getAccessToken(flaggedAccount);

    expect(token).toBe("fresh");
    expect(await readNeedsReauth()).toBe(0);
  });
});
