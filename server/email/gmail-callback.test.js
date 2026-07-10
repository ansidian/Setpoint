import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
} from "./test-utils/email-index-db.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
  },
}));
vi.mock("../platform/encryption.js", () => ({
  decrypt: (value) => value,
  encrypt: (value) => value,
}));

vi.stubGlobal("fetch", vi.fn());

const { handleCallback } = await import("./gmail.js");

describe("gmail callback canonicalization", () => {
  beforeEach(async () => {
    testState.db.current = await createEmailIndexTestDb({
      extraMigrations: [
        "006_email_search_embedding_state.sql",
        "007_email_search_ai_usage.sql",
        "028_provider_needs_reauth.sql",
      ],
    });
    fetch.mockReset();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("reuses the canonical Gmail row when the same email is re-authorized", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-fresh",
      type: "gmail",
      email: "user@example.com",
      label: "Work",
      sort_order: 2,
      created_at: "2026-05-10T12:00:00.000Z",
      updated_at: "2026-05-10T12:00:00.000Z",
    });
    await seedEmailAccount(testState.db.current, {
      id: "gmail-old",
      type: "gmail",
      email: "USER@example.com",
      label: "Work old",
      sort_order: 7,
      created_at: "2026-05-09T12:00:00.000Z",
      updated_at: "2026-05-09T12:00:00.000Z",
    });
    fetch
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
    const rows = await testState.db.current.execute({
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
    expect(JSON.parse(rows.rows[0].credentials_encrypted)).toMatchObject({
      access_token: "tok",
      refresh_token: "rtok",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    });
  });

  it("sends the token-exchange and profile fetches with an AbortSignal (REL-02)", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-fresh",
      type: "gmail",
      email: "user@example.com",
      label: "Work",
    });
    fetch
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

    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });
});
