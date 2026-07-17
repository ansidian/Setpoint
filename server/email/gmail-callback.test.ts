import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
} from "./test-utils/email-index-db.ts";
import type { Client, InStatement } from "@libsql/client";

type FetchMock = ReturnType<typeof vi.fn<(input: unknown, init?: RequestInit) => Promise<unknown>>>;

const testState = vi.hoisted((): { db: { current: Client | null } } => ({
  db: { current: null },
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
  decrypt: (value: string) => value,
  encrypt: (value: string) => value,
}));

const fetchMock: FetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<unknown>>();
vi.stubGlobal("fetch", fetchMock);

const { handleCallback } = await import("./gmail.ts");

describe("gmail callback canonicalization", () => {
  beforeEach(async () => {
    testState.db.current = await createEmailIndexTestDb({
      extraMigrations: [
        "006_email_search_embedding_state.sql",
        "007_email_search_ai_usage.sql",
        "028_provider_needs_reauth.sql",
        "032_canonical_url.sql",
      ],
    });
    fetchMock.mockReset();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("reuses the canonical Gmail row when the same email is re-authorized", async () => {
    await seedEmailAccount(currentDb(), {
      id: "gmail-fresh",
      type: "gmail",
      email: "user@example.com",
      label: "Work",
      sort_order: 2,
      created_at: "2026-05-10T12:00:00.000Z",
      updated_at: "2026-05-10T12:00:00.000Z",
    });
    await seedEmailAccount(currentDb(), {
      id: "gmail-old",
      type: "gmail",
      email: "USER@example.com",
      label: "Work old",
      sort_order: 7,
      created_at: "2026-05-09T12:00:00.000Z",
      updated_at: "2026-05-09T12:00:00.000Z",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "tok",
          refresh_token: "rtok",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.modify",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ emailAddress: "User@example.com" }),
      });

    const result = await handleCallback("auth-code", "ignored", "user-1");

    expect(result).toEqual({
      email: "User@example.com",
      accountId: "gmail-fresh",
    });
    const rows = await currentDb().execute({
      sql: `SELECT id, email, label, credentials_encrypted, sort_order
            FROM ea_accounts
            WHERE user_id = ? AND type = 'gmail'
            ORDER BY id`,
      args: ["user-1"],
    });
    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: "gmail-fresh",
        email: "User@example.com",
        label: "Work",
        sort_order: 2,
      }),
      expect.objectContaining({
        id: "gmail-old",
        email: "USER@example.com",
        label: "Work old",
        sort_order: 7,
      }),
    ]);
    expect(JSON.parse(String(rows.rows[0]?.credentials_encrypted ?? "{}"))).toMatchObject({
      access_token: "tok",
      refresh_token: "rtok",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    });
  });

  it("sends the token-exchange and profile fetches with an AbortSignal (REL-02)", async () => {
    await seedEmailAccount(currentDb(), {
      id: "gmail-fresh",
      type: "gmail",
      email: "user@example.com",
      label: "Work",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "tok",
          refresh_token: "rtok",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.modify",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ emailAddress: "user@example.com" }),
      });

    await handleCallback("auth-code", "ignored", "user-1");

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the persisted canonical Google callback for token exchange", async () => {
    await currentDb().execute({
      sql: `INSERT INTO ea_instance_metadata
              (singleton_id, canonical_origin, source, confirmed_at, updated_at)
            VALUES (1, ?, 'owner_confirmed', 100, 100)`,
      args: ["https://setpoint.example.com"],
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", refresh_token: "rtok", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ emailAddress: "user@example.com" }) });

    await handleCallback("auth-code", null, "user-1");

    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("redirect_uri")).toBe("https://setpoint.example.com/api/ea/accounts/gmail/callback");
  });
});
