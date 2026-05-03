import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDb = {
  execute: vi.fn(),
  batch: vi.fn(),
};

vi.mock("../db/connection.js", () => ({ default: mockDb }));

const gmailSync = await import("./gmail-sync.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function pubsubBody(payload, overrides = {}) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(payload)).toString("base64url"),
      messageId: "pubsub-1",
      publishTime: "2026-05-03T12:00:00.000Z",
      ...overrides,
    },
    subscription: "projects/ea/subscriptions/gmail-push",
  };
}

describe("Gmail Pub/Sub sync ingestion", () => {
  it("decodes a push notification and queues one account-level history sync job", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [{
          id: "gmail-work",
          user_id: "user-1",
          type: "gmail",
          email: "Work@Example.com",
        }],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    const result = await gmailSync.enqueueHistorySyncFromPubSub(pubsubBody({
      emailAddress: "work@example.com",
      historyId: "9876543210",
    }));

    expect(result).toEqual({
      queued: true,
      account_id: "gmail-work",
      user_id: "user-1",
      history_id: "9876543210",
      message_id: "pubsub-1",
    });
    expect(mockDb.execute).toHaveBeenNthCalledWith(1, {
      sql: expect.stringContaining("FROM ea_accounts"),
      args: ["work@example.com"],
    });
    expect(mockDb.execute).toHaveBeenNthCalledWith(2, {
      sql: expect.stringContaining("INSERT INTO ea_triage_jobs"),
      args: [
        "user-1",
        "gmail-work",
        null,
        "gmail_history_sync",
        "gmail_history_sync:user-1:gmail-work:9876543210",
        1,
        JSON.stringify({
          emailAddress: "work@example.com",
          historyId: "9876543210",
          pubsubMessageId: "pubsub-1",
          publishTime: "2026-05-03T12:00:00.000Z",
          subscription: "projects/ea/subscriptions/gmail-push",
        }),
        null,
      ],
    });
  });

  it("registers an INBOX watch and persists Gmail history cursor state", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        historyId: "1234567890",
        expiration: "1790000000000",
      }),
    }));
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 });

    const result = await gmailSync.registerGmailWatch({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: mockDb,
      fetchImpl,
      token: "access-token",
      topicName: "projects/ea/topics/gmail",
      now: new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          labelIds: ["INBOX"],
          labelFilterBehavior: "INCLUDE",
          topicName: "projects/ea/topics/gmail",
        }),
      },
    );
    expect(mockDb.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("INSERT INTO ea_gmail_watch_state"),
      args: [
        "user-1",
        "gmail-work",
        "work@example.com",
        "1234567890",
        "2026-09-21T14:13:20.000Z",
        "active",
        "2026-05-03T12:00:00.000Z",
        "",
      ],
    });
    expect(result).toEqual({
      account_id: "gmail-work",
      history_id: "1234567890",
      watch_expiration_at: "2026-09-21T14:13:20.000Z",
      status: "active",
    });
  });

  it("syncs Gmail history into indexed mail and idempotent message triage jobs", async () => {
    const indexEmailsFn = vi.fn(async () => {});
    const fetchEmailsByIdsFn = vi.fn(async () => [
      { uid: "gmail-gmail-work-msg-1", account_id: "gmail-work", subject: "One" },
      { uid: "gmail-gmail-work-msg-3", account_id: "gmail-work", subject: "Three" },
    ]);
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "105",
      history: [
        {
          messagesAdded: [
            { message: { id: "msg-1", labelIds: ["INBOX", "UNREAD"] } },
            { message: { id: "msg-2", labelIds: ["SENT"] } },
          ],
        },
        {
          labelsAdded: [
            { message: { id: "msg-3", labelIds: ["INBOX"] }, labelIds: ["INBOX"] },
          ],
        },
      ],
      nextPageToken: null,
    }));
    mockDb.execute.mockResolvedValueOnce({
      rows: [{
        last_history_id: "100",
      }],
    });
    mockDb.batch.mockResolvedValueOnce({ rows: [] });

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: mockDb,
      fetchHistoryPage,
      fetchEmailsByIdsFn,
      indexEmailsFn,
      targetHistoryId: "105",
      now: new Date("2026-05-03T12:15:00.000Z"),
    });

    expect(fetchHistoryPage).toHaveBeenCalledWith({
      account: expect.objectContaining({ id: "gmail-work" }),
      startHistoryId: "100",
      pageToken: null,
    });
    expect(fetchEmailsByIdsFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-work" }),
      ["msg-1", "msg-3"],
    );
    expect(indexEmailsFn).toHaveBeenCalledWith("user-1", [
      expect.objectContaining({ uid: "gmail-gmail-work-msg-1" }),
      expect.objectContaining({ uid: "gmail-gmail-work-msg-3" }),
    ]);
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
    const statements = mockDb.batch.mock.calls[0][0];
    expect(statements).toEqual([
      expect.objectContaining({
        sql: expect.stringContaining("INSERT OR IGNORE INTO ea_email_triage"),
        args: ["user-1", "gmail-work", "gmail-gmail-work-msg-1"],
      }),
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO ea_triage_jobs"),
        args: expect.arrayContaining([
          "email_triage:user-1:gmail-work:gmail-gmail-work-msg-1",
        ]),
      }),
      expect.objectContaining({
        sql: expect.stringContaining("INSERT OR IGNORE INTO ea_email_triage"),
        args: ["user-1", "gmail-work", "gmail-gmail-work-msg-3"],
      }),
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO ea_triage_jobs"),
        args: expect.arrayContaining([
          "email_triage:user-1:gmail-work:gmail-gmail-work-msg-3",
        ]),
      }),
      expect.objectContaining({
        sql: expect.stringContaining("UPDATE ea_gmail_watch_state"),
        args: ["105", "2026-05-03T12:15:00.000Z", "", "user-1", "gmail-work"],
      }),
    ]);
    expect(result).toEqual({
      account_id: "gmail-work",
      start_history_id: "100",
      last_history_id: "105",
      indexed: 2,
      queued: 2,
    });
  });
});
