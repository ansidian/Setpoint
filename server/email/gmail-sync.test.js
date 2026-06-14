import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCurrentDashboardEventsForTests, subscribeCurrentDashboardEvents } from "../dashboard/current-events.js";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
  seedIndexedEmail,
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
  __resetCurrentDashboardEventsForTests();
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

async function seedTriagedIndexedEmail({
  uid = "gmail-gmail-work-msg-1",
  accountId = "gmail-work",
  providerState = "available",
} = {}) {
  await seedIndexedEmail(testState.db.current, {
    uid,
    account_id: accountId,
  });
  const triage = await testState.db.current.execute({
    sql: `INSERT INTO ea_email_triage
            (user_id, account_id, email_id, triage_status, lane, provider_state)
          VALUES (?, ?, ?, 'complete', 'needs_attention', ?)
          RETURNING id`,
    args: ["user-1", accountId, uid, providerState],
  });
  return Number(triage.rows[0].id);
}

async function seedActiveSnapshotItem(triageId, {
  uid = "gmail-gmail-work-msg-1",
  accountId = "gmail-work",
} = {}) {
  const snapshot = await testState.db.current.execute({
    sql: `INSERT INTO ea_briefing_snapshots
            (user_id, start_at, end_at, timezone, status)
          VALUES (?, ?, ?, 'America/Los_Angeles', 'active')
          RETURNING id`,
    args: ["user-1", "2026-05-03T00:00:00.000Z", "2026-05-04T00:00:00.000Z"],
  });
  await testState.db.current.execute({
    sql: `INSERT INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id, lane_at_snapshot)
          VALUES (?, ?, ?, ?, ?, 'needs_attention')`,
    args: [Number(snapshot.rows[0].id), triageId, "user-1", accountId, uid],
  });
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

  it("enqueues normal fresh mail into arrival grace and attaches it to the active snapshot", async () => {
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-fresh-1",
      read: 0,
      email_date: "2026-05-03T12:00:00.000Z",
    });

    const events = [];
    const unsubscribe = subscribeCurrentDashboardEvents("user-1", (event) => events.push(event));

    const result = await gmailSync.enqueueEmailTriageForEmails(
      "user-1",
      [{
        uid: "gmail-work-fresh-1",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Fresh Sender <fresh@example.com>",
        subject: "Fresh arrival",
        body_snippet: "This should wait briefly.",
        email_date: "2026-05-03T12:00:00.000Z",
      }],
      {
        dbClient: testState.db.current,
        now: new Date("2026-05-03T12:00:00.000Z"),
      },
    );

    expect(result).toEqual({ queued: 1 });
    const rows = await testState.db.current.execute({
      sql: `SELECT t.triage_status,
                   t.triage_source,
                   j.status AS job_status,
                   j.scheduled_for,
                   i.lane_at_snapshot,
                   i.from_name_at_snapshot,
                   i.from_address_at_snapshot,
                   i.source,
                   i.source_at
            FROM ea_email_triage t
            JOIN ea_triage_jobs j ON j.user_id = t.user_id
             AND j.account_id = t.account_id
             AND j.email_id = t.email_id
             AND j.job_type = 'email_triage'
            JOIN ea_briefing_snapshot_items i ON i.triage_id = t.id
            WHERE t.email_id = ?`,
      args: ["gmail-work-fresh-1"],
    });
    expect(rows.rows).toEqual([
      {
        triage_status: "pending",
        triage_source: "arrival_grace",
        job_status: "queued",
        scheduled_for: "2026-05-03T12:03:00.000Z",
        lane_at_snapshot: "queued",
        from_name_at_snapshot: "Fresh Sender",
        from_address_at_snapshot: "fresh@example.com",
        source: "arrival_grace",
        source_at: "2026-05-03T12:03:00.000Z",
      },
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        source: "email_triage",
        reason: "email_triage_queued",
        details: {
          triggerType: "email_queued",
          eventKey: "email_triage:gmail-work:gmail-work-fresh-1:email_triage_queued",
          emailId: "gmail-work-fresh-1",
          lane: "queued",
          triageSource: "arrival_grace",
          reason: "email_triage_queued",
        },
      }),
    ]);
    unsubscribe();
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

  it("fetches Gmail history broadly while watch registration remains INBOX scoped", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ historyId: "101", history: [] }),
    }));

    await gmailSync.fetchGmailHistoryPage({
      account: {
        id: "gmail-work",
        user_id: "user-1",
        email: "work@example.com",
      },
      startHistoryId: "100",
      fetchImpl,
      token: "access-token",
    });

    const url = fetchImpl.mock.calls[0][0];
    expect(url.searchParams.get("labelId")).toBeNull();
    expect(url.searchParams.getAll("historyTypes")).toEqual([
      "messageAdded",
      "labelAdded",
      "labelRemoved",
      "messageDeleted",
    ]);
  });

  it("recovers an expired Gmail history cursor by indexing current inbox and advancing the target cursor", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "stale-history"],
    });
    const expired = new Error("Gmail history.list failed for work@example.com: 404");
    expired.status = 404;
    const fetchHistoryPage = vi.fn(async () => {
      throw expired;
    });
    const fetchEmailsFn = vi.fn(async () => [
      {
        uid: "gmail-gmail-work-current-msg",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        from: "Current Sender <current@example.com>",
        subject: "Current inbox message",
        body_preview: "Current preview",
        body_text: "Current body",
        date: "2026-05-03T12:05:00.000Z",
        read: false,
      },
    ]);

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsFn,
      targetHistoryId: "900",
      now: new Date("2026-05-03T15:30:00.000Z"),
    });

    expect(fetchEmailsFn).toHaveBeenCalledWith(expect.objectContaining({ id: "gmail-work" }), 336);
    expect(result).toMatchObject({
      account_id: "gmail-work",
      start_history_id: "stale-history",
      last_history_id: "900",
      indexed: 1,
      queued: 1,
      history_recovered: true,
    });
    const watchState = await testState.db.current.execute({
      sql: `SELECT last_history_id, last_sync_at, last_error
            FROM ea_gmail_watch_state
            WHERE account_id = ?`,
      args: ["gmail-work"],
    });
    expect(watchState.rows[0]).toEqual({
      last_history_id: "900",
      last_sync_at: "2026-05-03T15:30:00.000Z",
      last_error: "",
    });
    const jobs = await testState.db.current.execute({
      sql: `SELECT email_id, job_type, scheduled_for, payload_json
            FROM ea_triage_jobs
            WHERE job_type = 'email_triage'`,
      args: [],
    });
    expect(jobs.rows).toEqual([
      {
        email_id: "gmail-gmail-work-current-msg",
        job_type: "email_triage",
        scheduled_for: null,
        payload_json: JSON.stringify({
          uid: "gmail-gmail-work-current-msg",
          subject: "Current inbox message",
        }),
      },
    ]);
  });

  it("recovers via lookback re-fetch when the history page cap is hit, instead of failing the job (P2-26)", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "100"],
    });
    // Every page returns a nextPageToken, so the loop hits MAX_HISTORY_PAGES with a token still pending.
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "200",
      history: [{ messagesAdded: [{ message: { id: "msg-capped", labelIds: ["INBOX"] } }] }],
      nextPageToken: "more",
    }));
    const fetchEmailsFn = vi.fn(async () => [{
      uid: "gmail-gmail-work-recovered",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      from: "Recovered <r@example.com>",
      subject: "Recovered message",
      body_preview: "p",
      body_text: "b",
      date: "2026-05-03T12:05:00.000Z",
      read: false,
    }]);

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work", user_id: "user-1", email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsFn,
      fetchEmailsByIdsFn: vi.fn(async () => []),
      targetHistoryId: "900",
      now: new Date("2026-05-03T15:30:00.000Z"),
    });

    expect(fetchEmailsFn).toHaveBeenCalled(); // lookback recovery ran instead of throwing the job away
    expect(result).toMatchObject({ history_recovered: true, indexed: 1 });
  });

  it("retries dropped messages once so a transient per-message failure isn't skipped permanently (P2-25)", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "100"],
    });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "105",
      history: [{ messagesAdded: [
        { message: { id: "msg-1", labelIds: ["INBOX"] } },
        { message: { id: "msg-2", labelIds: ["INBOX"] } },
      ] }],
      nextPageToken: null,
    }));
    const emailFor = (id, subject) => ({
      uid: `gmail-gmail-work-${id}`,
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      from: "Sender <s@example.com>",
      subject,
      body_preview: "p",
      body_text: "b",
      date: "2026-05-03T12:01:00.000Z",
      read: false,
    });
    // First fetch drops msg-2 (returns only msg-1); the bounded retry returns both.
    const fetchEmailsByIdsFn = vi.fn()
      .mockResolvedValueOnce([emailFor("msg-1", "One")])
      .mockResolvedValueOnce([emailFor("msg-1", "One"), emailFor("msg-2", "Two")]);

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work", user_id: "user-1", email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn,
      targetHistoryId: "105",
      now: new Date("2026-05-03T12:15:00.000Z"),
    });

    expect(fetchEmailsByIdsFn).toHaveBeenCalledTimes(2); // dropped msg-2 retried, not skipped
    expect(result.indexed).toBe(2);
  });

  it("does not persist the stale cursor on 404 recovery; falls back to the profile historyId when no target is given", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "stale-history"],
    });
    const expired = new Error("Gmail history.list failed for work@example.com: 404");
    expired.status = 404;
    const fetchHistoryPage = vi.fn(async () => {
      throw expired;
    });
    const fetchEmailsFn = vi.fn(async () => []);
    const fetchProfileHistoryIdFn = vi.fn(async () => "999000");

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsFn,
      fetchProfileHistoryIdFn,
      targetHistoryId: null,
      now: new Date("2026-05-03T16:00:00.000Z"),
    });

    expect(fetchProfileHistoryIdFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-work" }),
    );
    expect(result).toMatchObject({
      last_history_id: "999000",
      history_recovered: true,
    });
    const watchState = await testState.db.current.execute({
      sql: `SELECT last_history_id FROM ea_gmail_watch_state WHERE account_id = ?`,
      args: ["gmail-work"],
    });
    expect(watchState.rows[0].last_history_id).toBe("999000");
    expect(watchState.rows[0].last_history_id).not.toBe("stale-history");
  });

  it("leaves the stored Gmail cursor untouched on 404 recovery when no target and the profile fetch fails", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "stale-history"],
    });
    const expired = new Error("Gmail history.list failed for work@example.com: 404");
    expired.status = 404;
    const fetchHistoryPage = vi.fn(async () => {
      throw expired;
    });
    const fetchEmailsFn = vi.fn(async () => []);
    const fetchProfileHistoryIdFn = vi.fn(async () => {
      throw new Error("profile unavailable");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsFn,
      fetchProfileHistoryIdFn,
      targetHistoryId: null,
      now: new Date("2026-05-03T16:30:00.000Z"),
    });

    expect(result.history_recovered).toBe(true);
    const watchState = await testState.db.current.execute({
      sql: `SELECT last_history_id, last_sync_at FROM ea_gmail_watch_state WHERE account_id = ?`,
      args: ["gmail-work"],
    });
    // Cursor is NOT advanced to a fresh id, but it is NOT overwritten with the stale 404'd id either.
    expect(watchState.rows[0].last_history_id).toBe("stale-history");
    expect(watchState.rows[0].last_sync_at).toBe("2026-05-03T16:30:00.000Z");
    warnSpy.mockRestore();
  });

  it("skips a gmail_history_sync job whose payload lacks a historyId instead of running a backfill", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      user_id: "user-1",
      type: "gmail",
      email: "work@example.com",
      label: "Work",
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key,
               priority, payload_json, status)
            VALUES (?, ?, NULL, 'gmail_history_sync', ?, 1, ?, 'queued')`,
      args: [
        "user-1",
        "gmail-work",
        "gmail_history_sync:user-1:gmail-work:no-history",
        JSON.stringify({ emailAddress: "work@example.com" }),
      ],
    });

    const result = await gmailSync.processNextGmailHistorySyncJob({
      dbClient: testState.db.current,
      now: new Date("2026-05-03T17:00:00.000Z"),
    });

    expect(result).toMatchObject({ processed: true, skipped: true });
    const jobs = await testState.db.current.execute({
      sql: `SELECT status, last_error FROM ea_triage_jobs WHERE job_type = 'gmail_history_sync'`,
      args: [],
    });
    expect(jobs.rows[0].status).toBe("complete");
    expect(jobs.rows[0].last_error).toBe("missing historyId in payload");
    // No backfill side effects: nothing indexed.
    const indexed = await testState.db.current.execute({
      sql: "SELECT COUNT(*) AS count FROM ea_email_index",
      args: [],
    });
    expect(indexed.rows[0].count).toBe(0);
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
      read_state_reconciled: 0,
      provider_removed: 0,
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
      {
        uid: "gmail-gmail-work-msg-1",
        subject: "One",
        arrivalGrace: true,
        queuedAt: "2026-05-03T12:15:00.000Z",
        graceDeadline: "2026-05-03T12:18:00.000Z",
      },
      {
        uid: "gmail-gmail-work-msg-3",
        subject: "Three",
        arrivalGrace: true,
        queuedAt: "2026-05-03T12:15:00.000Z",
        graceDeadline: "2026-05-03T12:18:00.000Z",
      },
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

  it("reconciles Gmail unread label changes for already indexed mail without queueing triage", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "200"],
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-gmail-work-msg-1",
      account_id: "gmail-work",
      read: 1,
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, lane, provider_state)
            VALUES (?, ?, ?, 'complete', 'action', 'active')`,
      args: ["user-1", "gmail-work", "gmail-gmail-work-msg-1"],
    });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "205",
      history: [
        {
          labelsAdded: [
            { message: { id: "msg-1", labelIds: ["INBOX", "UNREAD"] }, labelIds: ["UNREAD"] },
          ],
        },
      ],
      nextPageToken: null,
    }));
    const fetchEmailsByIdsFn = vi.fn(async () => []);
    const fetchMessageReadStateFn = vi.fn(async () => false);

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn,
      fetchMessageReadStateFn,
      targetHistoryId: "205",
      now: new Date("2026-05-03T12:30:00.000Z"),
    });

    expect(fetchEmailsByIdsFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-work" }),
      [],
    );
    expect(fetchMessageReadStateFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-work" }),
      "msg-1",
    );
    expect(result).toEqual({
      account_id: "gmail-work",
      start_history_id: "200",
      last_history_id: "205",
      indexed: 0,
      queued: 0,
      read_state_reconciled: 1,
      provider_removed: 0,
    });

    const indexed = await testState.db.current.execute({
      sql: `SELECT read
            FROM ea_email_index
            WHERE uid = ?`,
      args: ["gmail-gmail-work-msg-1"],
    });
    expect(indexed.rows[0].read).toBe(0);

    const triageRows = await testState.db.current.execute({
      sql: `SELECT triage_status, lane, provider_state
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["gmail-gmail-work-msg-1"],
    });
    expect(triageRows.rows).toEqual([
      { triage_status: "complete", lane: "action", provider_state: "active" },
    ]);

    const jobs = await testState.db.current.execute({
      sql: `SELECT email_id, job_type
            FROM ea_triage_jobs
            WHERE job_type = 'email_triage'`,
      args: [],
    });
    expect(jobs.rows).toEqual([]);

    const watchState = await testState.db.current.execute({
      sql: `SELECT last_history_id, last_error
            FROM ea_gmail_watch_state
            WHERE account_id = ?`,
      args: ["gmail-work"],
    });
    expect(watchState.rows[0]).toEqual({
      last_history_id: "205",
      last_error: "",
    });
  });

  it("reconciles Gmail read label removals from current metadata", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "300"],
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-gmail-work-msg-2",
      account_id: "gmail-work",
      read: 0,
    });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "305",
      history: [
        {
          labelsRemoved: [
            { message: { id: "msg-2", labelIds: ["INBOX"] }, labelIds: ["UNREAD"] },
          ],
        },
      ],
      nextPageToken: null,
    }));
    const fetchMessageReadStateFn = vi.fn(async () => true);

    await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn: vi.fn(async () => []),
      fetchMessageReadStateFn,
      targetHistoryId: "305",
      now: new Date("2026-05-03T12:45:00.000Z"),
    });

    expect(fetchMessageReadStateFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-work" }),
      "msg-2",
    );
    const indexed = await testState.db.current.execute({
      sql: `SELECT read
            FROM ea_email_index
            WHERE uid = ?`,
      args: ["gmail-gmail-work-msg-2"],
    });
    expect(indexed.rows[0].read).toBe(1);
  });

  it("skips unread label events for unknown old Gmail messages", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "400"],
    });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "405",
      history: [
        {
          labelsAdded: [
            { message: { id: "old-msg", labelIds: ["INBOX", "UNREAD"] }, labelIds: ["UNREAD"] },
          ],
        },
      ],
      nextPageToken: null,
    }));
    const fetchEmailsByIdsFn = vi.fn(async () => []);
    const fetchMessageReadStateFn = vi.fn(async () => false);

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn,
      fetchMessageReadStateFn,
      targetHistoryId: "405",
      now: new Date("2026-05-03T13:00:00.000Z"),
    });

    expect(fetchEmailsByIdsFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-work" }),
      [],
    );
    expect(fetchMessageReadStateFn).not.toHaveBeenCalled();
    expect(result.read_state_reconciled).toBe(0);

    const indexed = await testState.db.current.execute({
      sql: "SELECT COUNT(*) AS count FROM ea_email_index",
      args: [],
    });
    expect(indexed.rows[0].count).toBe(0);
  });

  it("logs read-state failures but still advances the Gmail history cursor", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "500"],
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-gmail-work-msg-5",
      account_id: "gmail-work",
      read: 1,
    });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "505",
      history: [
        {
          labelsAdded: [
            { message: { id: "msg-5", labelIds: ["INBOX", "UNREAD"] }, labelIds: ["UNREAD"] },
          ],
        },
      ],
      nextPageToken: null,
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn: vi.fn(async () => []),
      fetchMessageReadStateFn: vi.fn(async () => {
        throw new Error("metadata unavailable");
      }),
      targetHistoryId: "505",
      now: new Date("2026-05-03T13:15:00.000Z"),
    });

    expect(result.read_state_reconciled).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      "[Gmail Sync] Failed to reconcile read state for work@example.com/msg-5: metadata unavailable",
    );
    const indexed = await testState.db.current.execute({
      sql: `SELECT read
            FROM ea_email_index
            WHERE uid = ?`,
      args: ["gmail-gmail-work-msg-5"],
    });
    expect(indexed.rows[0].read).toBe(1);
    const watchState = await testState.db.current.execute({
      sql: `SELECT last_history_id, last_error
            FROM ea_gmail_watch_state
            WHERE account_id = ?`,
      args: ["gmail-work"],
    });
    expect(watchState.rows[0]).toEqual({
      last_history_id: "505",
      last_error: "",
    });

    warnSpy.mockRestore();
  });

  it("marks an externally archived Gmail message provider-removed without queueing triage", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "600"],
    });
    const triageId = await seedTriagedIndexedEmail();
    await seedActiveSnapshotItem(triageId);
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "605",
      history: [
        {
          labelsRemoved: [
            { message: { id: "msg-1", labelIds: [] }, labelIds: ["INBOX"] },
          ],
        },
      ],
      nextPageToken: null,
    }));
    const fetchMessageMetadataFn = vi.fn(async () => ({ labelIds: [] }));

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn: vi.fn(async () => []),
      fetchMessageMetadataFn,
      targetHistoryId: "605",
      now: new Date("2026-05-03T14:00:00.000Z"),
    });

    expect(fetchMessageMetadataFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-work" }),
      "msg-1",
    );
    expect(result.provider_removed).toBe(1);
    const triage = await testState.db.current.execute({
      sql: `SELECT provider_state
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["gmail-gmail-work-msg-1"],
    });
    expect(triage.rows[0].provider_state).toBe("archived");
    const item = await testState.db.current.execute({
      sql: `SELECT provider_removed_at
            FROM ea_briefing_snapshot_items
            WHERE email_id = ?`,
      args: ["gmail-gmail-work-msg-1"],
    });
    expect(item.rows[0].provider_removed_at).toBe("2026-05-03T14:00:00.000Z");
    const jobs = await testState.db.current.execute({
      sql: `SELECT email_id, job_type
            FROM ea_triage_jobs
            WHERE job_type = 'email_triage'`,
      args: [],
    });
    expect(jobs.rows).toEqual([]);
  });

  it("marks external Gmail trash and delete events as trashed for known rows only", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "700"],
    });
    await seedTriagedIndexedEmail({ uid: "gmail-gmail-work-trash-msg" });
    await seedTriagedIndexedEmail({ uid: "gmail-gmail-work-deleted-msg" });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "705",
      history: [
        {
          labelsRemoved: [
            { message: { id: "trash-msg", labelIds: ["TRASH"] }, labelIds: ["INBOX"] },
            { message: { id: "unknown-msg", labelIds: ["TRASH"] }, labelIds: ["INBOX"] },
          ],
          messagesDeleted: [
            { message: { id: "deleted-msg" } },
          ],
        },
      ],
      nextPageToken: null,
    }));
    const fetchMessageMetadataFn = vi.fn(async (_account, messageId) => {
      if (messageId === "trash-msg") return { labelIds: ["TRASH"] };
      if (messageId === "deleted-msg") return null;
      throw new Error(`unexpected metadata fetch ${messageId}`);
    });

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn: vi.fn(async () => []),
      fetchMessageMetadataFn,
      targetHistoryId: "705",
      now: new Date("2026-05-03T14:30:00.000Z"),
    });

    expect(result.provider_removed).toBe(2);
    expect(fetchMessageMetadataFn).toHaveBeenCalledTimes(2);
    const triage = await testState.db.current.execute({
      sql: `SELECT email_id, provider_state
            FROM ea_email_triage
            ORDER BY email_id`,
      args: [],
    });
    expect(triage.rows).toEqual([
      { email_id: "gmail-gmail-work-deleted-msg", provider_state: "trashed" },
      { email_id: "gmail-gmail-work-trash-msg", provider_state: "trashed" },
    ]);
    const indexed = await testState.db.current.execute({
      sql: "SELECT uid FROM ea_email_index WHERE uid LIKE '%unknown-msg'",
      args: [],
    });
    expect(indexed.rows).toEqual([]);
  });

  it("treats Gmail TRASH label additions as provider removal", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "720"],
    });
    await seedTriagedIndexedEmail({ uid: "gmail-gmail-work-trash-added-msg" });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "725",
      history: [
        {
          labelsAdded: [
            { message: { id: "trash-added-msg", labelIds: ["TRASH"] }, labelIds: ["TRASH"] },
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
      fetchEmailsByIdsFn: vi.fn(async () => []),
      fetchMessageMetadataFn: vi.fn(async () => ({ labelIds: ["TRASH"] })),
      targetHistoryId: "725",
      now: new Date("2026-05-03T14:45:00.000Z"),
    });

    expect(result.provider_removed).toBe(1);
    const triage = await testState.db.current.execute({
      sql: `SELECT provider_state
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["gmail-gmail-work-trash-added-msg"],
    });
    expect(triage.rows[0].provider_state).toBe("trashed");
  });

  it("falls back to archived for known INBOX removals when metadata no longer exists", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "730"],
    });
    await seedTriagedIndexedEmail({ uid: "gmail-gmail-work-archive-gone-msg" });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "735",
      history: [
        {
          labelsRemoved: [
            { message: { id: "archive-gone-msg" }, labelIds: ["INBOX"] },
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
      fetchEmailsByIdsFn: vi.fn(async () => []),
      fetchMessageMetadataFn: vi.fn(async () => null),
      targetHistoryId: "735",
      now: new Date("2026-05-03T14:50:00.000Z"),
    });

    expect(result.provider_removed).toBe(1);
    const triage = await testState.db.current.execute({
      sql: `SELECT provider_state
            FROM ea_email_triage
            WHERE email_id = ?`,
      args: ["gmail-gmail-work-archive-gone-msg"],
    });
    expect(triage.rows[0].provider_state).toBe("archived");
  });

  it("matches Gmail read-state reconciliation through stale UID account IDs for the same mailbox", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-fresh", "work@example.com", "800"],
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-gmail-previous-msg-1",
      account_id: "gmail-previous",
      account_email: "work@example.com",
      read: 1,
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-gmail-other-msg-1",
      account_id: "gmail-other",
      account_email: "other@example.com",
      read: 1,
    });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "805",
      history: [
        {
          labelsAdded: [
            { message: { id: "msg-1", labelIds: ["UNREAD"] }, labelIds: ["UNREAD"] },
          ],
        },
      ],
      nextPageToken: null,
    }));

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-fresh",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn: vi.fn(async () => []),
      fetchMessageReadStateFn: vi.fn(async () => false),
      targetHistoryId: "805",
      now: new Date("2026-05-03T15:00:00.000Z"),
    });

    expect(result.read_state_reconciled).toBe(1);
    const indexed = await testState.db.current.execute({
      sql: `SELECT uid, read
            FROM ea_email_index
            ORDER BY uid`,
      args: [],
    });
    expect(indexed.rows).toEqual([
      { uid: "gmail-gmail-other-msg-1", read: 1 },
      { uid: "gmail-gmail-previous-msg-1", read: 0 },
    ]);
  });

  it("updates duplicate Gmail rows for the same mailbox during reconciliation", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-fresh", "work@example.com", "810"],
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-gmail-previous-a-msg-2",
      account_id: "gmail-previous-a",
      account_email: "work@example.com",
      read: 1,
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-gmail-previous-b-msg-2",
      account_id: "gmail-previous-b",
      account_email: "work@example.com",
      read: 1,
    });
    const fetchHistoryPage = vi.fn(async () => ({
      historyId: "815",
      history: [
        {
          labelsAdded: [
            { message: { id: "msg-2", labelIds: ["UNREAD"] }, labelIds: ["UNREAD"] },
          ],
        },
      ],
      nextPageToken: null,
    }));

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-fresh",
      user_id: "user-1",
      email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn: vi.fn(async () => []),
      fetchMessageReadStateFn: vi.fn(async () => false),
      targetHistoryId: "815",
      now: new Date("2026-05-03T15:05:00.000Z"),
    });

    expect(result.read_state_reconciled).toBe(2);
    const indexed = await testState.db.current.execute({
      sql: `SELECT uid, read
            FROM ea_email_index
            ORDER BY uid`,
      args: [],
    });
    expect(indexed.rows).toEqual([
      { uid: "gmail-gmail-previous-a-msg-2", read: 0 },
      { uid: "gmail-gmail-previous-b-msg-2", read: 0 },
    ]);
  });
});
