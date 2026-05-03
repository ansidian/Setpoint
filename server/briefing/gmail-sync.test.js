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
    batch: (...args) => testState.db.current.batch(...args),
  },
}));

const gmailSync = await import("./gmail-sync.js");

beforeEach(async () => {
  testState.db.current = await createEmailIndexTestDb();
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
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
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      user_id: "user-1",
      type: "gmail",
      email: "Work@Example.com",
      label: "Work",
    });

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
    const jobs = await testState.db.current.execute({
      sql: `SELECT user_id, account_id, email_id, job_type, idempotency_key,
                   priority, payload_json, scheduled_for, status
            FROM ea_triage_jobs`,
      args: [],
    });
    expect(jobs.rows).toEqual([
      expect.objectContaining({
        user_id: "user-1",
        account_id: "gmail-work",
        email_id: null,
        job_type: "gmail_history_sync",
        idempotency_key: "gmail_history_sync:user-1:gmail-work:9876543210",
        priority: 1,
        scheduled_for: null,
        status: "queued",
      }),
    ]);
    expect(JSON.parse(jobs.rows[0].payload_json)).toEqual({
      emailAddress: "work@example.com",
      historyId: "9876543210",
      pubsubMessageId: "pubsub-1",
      publishTime: "2026-05-03T12:00:00.000Z",
      subscription: "projects/ea/subscriptions/gmail-push",
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

    const result = await gmailSync.registerGmailWatch({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
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
    expect(result).toEqual({
      account_id: "gmail-work",
      history_id: "1234567890",
      watch_expiration_at: "2026-09-21T14:13:20.000Z",
      status: "active",
    });

    const state = await testState.db.current.execute({
      sql: `SELECT user_id, account_id, email_address, last_history_id,
                   watch_expiration_at, watch_status, last_renewed_at,
                   last_error
            FROM ea_gmail_watch_state
            WHERE account_id = ?`,
      args: ["gmail-work"],
    });
    expect(state.rows).toEqual([
      {
        user_id: "user-1",
        account_id: "gmail-work",
        email_address: "work@example.com",
        last_history_id: "1234567890",
        watch_expiration_at: "2026-09-21T14:13:20.000Z",
        watch_status: "active",
        last_renewed_at: "2026-05-03T12:00:00.000Z",
        last_error: "",
      },
    ]);
  });

  it("syncs Gmail history into indexed mail and idempotent message triage jobs", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "100"],
    });
    const fetchEmailsByIdsFn = vi.fn(async () => [
      {
        uid: "gmail-gmail-work-msg-1",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        from: "One Sender <one@example.com>",
        subject: "One",
        body_preview: "One preview",
        body_text: "One body",
        date: "2026-05-03T12:01:00.000Z",
        read: false,
      },
      {
        uid: "gmail-gmail-work-msg-3",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        from: "Three Sender <three@example.com>",
        subject: "Three",
        body_preview: "Three preview",
        body_text: "Three body",
        date: "2026-05-03T12:03:00.000Z",
        read: true,
      },
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

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn,
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
    expect(result).toEqual({
      account_id: "gmail-work",
      start_history_id: "100",
      last_history_id: "105",
      indexed: 2,
      queued: 2,
    });

    const indexed = await testState.db.current.execute({
      sql: `SELECT uid, subject, body_text, read
            FROM ea_email_index
            ORDER BY uid`,
      args: [],
    });
    expect(indexed.rows).toEqual([
      {
        uid: "gmail-gmail-work-msg-1",
        subject: "One",
        body_text: "One body",
        read: 0,
      },
      {
        uid: "gmail-gmail-work-msg-3",
        subject: "Three",
        body_text: "Three body",
        read: 1,
      },
    ]);

    const triageRows = await testState.db.current.execute({
      sql: `SELECT email_id, triage_status
            FROM ea_email_triage
            ORDER BY email_id`,
      args: [],
    });
    expect(triageRows.rows).toEqual([
      { email_id: "gmail-gmail-work-msg-1", triage_status: "pending" },
      { email_id: "gmail-gmail-work-msg-3", triage_status: "pending" },
    ]);

    const jobs = await testState.db.current.execute({
      sql: `SELECT email_id, job_type, idempotency_key, priority, payload_json
            FROM ea_triage_jobs
            WHERE job_type = 'email_triage'
            ORDER BY email_id`,
      args: [],
    });
    expect(jobs.rows).toEqual([
      expect.objectContaining({
        email_id: "gmail-gmail-work-msg-1",
        job_type: "email_triage",
        idempotency_key: "email_triage:user-1:gmail-work:gmail-gmail-work-msg-1",
        priority: 2,
      }),
      expect.objectContaining({
        email_id: "gmail-gmail-work-msg-3",
        job_type: "email_triage",
        idempotency_key: "email_triage:user-1:gmail-work:gmail-gmail-work-msg-3",
        priority: 2,
      }),
    ]);
    expect(jobs.rows.map((row) => JSON.parse(row.payload_json))).toEqual([
      { uid: "gmail-gmail-work-msg-1", subject: "One" },
      { uid: "gmail-gmail-work-msg-3", subject: "Three" },
    ]);

    const watchState = await testState.db.current.execute({
      sql: `SELECT last_history_id, last_sync_at, last_error
            FROM ea_gmail_watch_state
            WHERE account_id = ?`,
      args: ["gmail-work"],
    });
    expect(watchState.rows[0]).toEqual({
      last_history_id: "105",
      last_sync_at: "2026-05-03T12:15:00.000Z",
      last_error: "",
    });
  });
});
