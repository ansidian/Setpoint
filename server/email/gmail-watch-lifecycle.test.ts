import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import type * as GmailModule from "./gmail.ts";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
} from "./test-utils/email-index-db.ts";

const gmailApi = vi.hoisted(() => ({
  getAccessToken: vi.fn(async (account: { id: string }) => `token-${account.id}`),
}));

vi.mock("./gmail.ts", async (importOriginal) => ({
  ...await importOriginal<typeof GmailModule>(),
  getAccessToken: gmailApi.getAccessToken,
}));

const {
  registerGmailWatch,
  renewDueGmailWatches,
} = await import("./gmail-watch-lifecycle.ts");

let database: Client;

beforeEach(async () => {
  database = await createEmailIndexTestDb();
  gmailApi.getAccessToken.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  database.close();
});

describe("Gmail watch lifecycle", () => {
  it("registers a watch and durably stores the provider cursor and expiration", async () => {
    const seeded = await seedEmailAccount(database);
    const account = {
      id: seeded.id,
      user_id: seeded.user_id,
      email: seeded.email,
      type: "gmail" as const,
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ historyId: "501", expiration: "1785628800000" }),
    }));
    const now = new Date("2026-08-01T12:00:00.000Z");

    const result = await registerGmailWatch(account, {
      dbClient: database,
      fetchImpl,
      token: "access-token",
      topicName: "projects/setpoint/topics/gmail-push",
      now,
    });

    expect(result).toEqual({
      account_id: "gmail-work",
      history_id: "501",
      watch_expiration_at: "2026-08-02T00:00:00.000Z",
      status: "active",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          labelIds: ["INBOX"],
          labelFilterBehavior: "INCLUDE",
          topicName: "projects/setpoint/topics/gmail-push",
        }),
      }),
    );
    const stored = await database.execute({
      sql: `SELECT last_history_id, watch_expiration_at, watch_status,
                   last_renewed_at, last_error
            FROM ea_gmail_watch_state
            WHERE user_id = ? AND account_id = ?`,
      args: [account.user_id, account.id],
    });
    expect(stored.rows[0]).toEqual({
      last_history_id: "501",
      watch_expiration_at: "2026-08-02T00:00:00.000Z",
      watch_status: "active",
      last_renewed_at: now.toISOString(),
      last_error: "",
    });
  });

  it("renews every due account independently and durably settles failures", async () => {
    await seedEmailAccount(database);
    await seedEmailAccount(database, {
      id: "gmail-bad",
      email: "bad@example.com",
      label: "Bad",
      sort_order: 1,
    });
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (authorization === "Bearer token-gmail-bad") {
        return {
          ok: false,
          status: 503,
          text: async () => "unavailable",
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ historyId: "777", expiration: "1785715200000" }),
      };
    });
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await renewDueGmailWatches({
      dbClient: database,
      now: new Date("2026-08-01T12:00:00.000Z"),
      topicName: "projects/setpoint/topics/gmail-push",
    });

    expect(result).toEqual({ checked: 2, renewed: 1, skipped: false });
    const stored = await database.execute({
      sql: `SELECT account_id, watch_status, last_history_id, last_error
            FROM ea_gmail_watch_state
            ORDER BY account_id`,
      args: [],
    });
    expect(stored.rows).toEqual([
      {
        account_id: "gmail-bad",
        watch_status: "error",
        last_history_id: null,
        last_error: "Gmail watch failed for bad@example.com: 503 unavailable",
      },
      {
        account_id: "gmail-work",
        watch_status: "active",
        last_history_id: "777",
        last_error: "",
      },
    ]);
  });

  it("skips account reads when no Pub/Sub topic is configured", async () => {
    const execute = vi.fn();

    await expect(renewDueGmailWatches({
      dbClient: { execute } as never,
      topicResolver: async () => null,
    })).resolves.toEqual({ checked: 0, renewed: 0, skipped: true });
    expect(execute).not.toHaveBeenCalled();
  });
});
