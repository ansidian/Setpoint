import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import { clearCurrentDashboardEventSubscribers } from "../dashboard/current-events.ts";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
} from "./test-utils/email-index-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null as unknown as Client },
}));

// test-architecture: allow-boundary-mock -- Gmail sync queue, cursor, index, and triage behavior runs against a migrated ephemeral libSQL client redirected through the production singleton seam.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => testState.db.current.execute(statement),
    batch: (statements: InStatement[], mode?: TransactionMode) => testState.db.current.batch(statements, mode),
  },
}));

const gmailSync = await import("./gmail-sync.ts");

beforeEach(async () => {
  clearCurrentDashboardEventSubscribers();
  testState.db.current = await createEmailIndexTestDb({
    extraMigrations: [
      "006_email_search_embedding_state.sql",
      "007_email_search_ai_usage.sql",
      "028_provider_needs_reauth.sql",
      "041_email_transaction_imports.sql",
      "042_transaction_import_item_subject.sql",
    ],
  });
});

afterEach(async () => {
  testState.db.current.close();
});

describe("Gmail Pub/Sub sync ingestion", () => {
  it("does not await or fail Gmail sync when transaction arrival ingestion is still pending", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "100"],
    });
    const email = {
      uid: "gmail-gmail-work-msg-transaction",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      from: "Amazon.com <auto-confirm@amazon.com>",
      subject: "Your Amazon.com order #111-2222222-3333333",
      body_preview: "Order preview",
      body_text: "Order 111-2222222-3333333 Order Total: $27.04",
      date: "2026-05-03T12:01:00.000Z",
      read: false,
    };
    const ingestTransactionArrivalsFn = vi.fn(() => new Promise(() => {}));

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work", user_id: "user-1", email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage: vi.fn(async () => ({
        historyId: "105",
        history: [{ messagesAdded: [{ message: { id: "msg-transaction", labelIds: ["INBOX"] } }] }],
        nextPageToken: null,
      })),
      fetchEmailsByIdsFn: vi.fn(async () => [email]),
      ingestTransactionArrivalsFn,
      targetHistoryId: "105",
      now: new Date("2026-05-03T12:15:00.000Z"),
    });

    expect(result).toMatchObject({ indexed: 1, queued: 1 });
    // test-architecture: allow-boundary-interaction -- Transaction-import admission is a background durable-worker boundary; sync must enqueue the exact normalized arrival without awaiting its drain.
    expect(ingestTransactionArrivalsFn).toHaveBeenCalledWith("user-1", "gmail-work", [email]);
  });

  it("recovers an expired Gmail history cursor by indexing current inbox and advancing the target cursor", async () => {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_gmail_watch_state
              (user_id, account_id, email_address, last_history_id, watch_status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: ["user-1", "gmail-work", "work@example.com", "stale-history"],
    });
    const expired = Object.assign(new Error("Gmail history.list failed for work@example.com: 404"), { status: 404 });
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

    // test-architecture: allow-boundary-interaction -- Gmail lookback is the outbound recovery boundary; an expired history cursor must request the exact account and bounded recovery horizon.
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

    // test-architecture: allow-boundary-interaction -- Gmail lookback is the outbound recovery boundary; a 404 cursor failure must enter provider recovery instead of discarding the durable job.
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
    const emailFor = (id: string, subject: string) => ({
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
    const requestEmailTriageDrainAtFn = vi.fn();

    const result = await gmailSync.syncGmailHistoryForAccount({
      id: "gmail-work", user_id: "user-1", email: "work@example.com",
    }, {
      dbClient: testState.db.current,
      fetchHistoryPage,
      fetchEmailsByIdsFn,
      targetHistoryId: "105",
      now: new Date("2026-05-03T12:15:00.000Z"),
      requestEmailTriageDrainAtFn,
    });

    // test-architecture: allow-boundary-interaction -- Gmail message fetch is outbound; an incomplete provider batch must retry the dropped identity rather than advance the durable cursor past it.
    expect(fetchEmailsByIdsFn).toHaveBeenCalledTimes(2); // dropped msg-2 retried, not skipped
    expect(result.indexed).toBe(2);
    // test-architecture: allow-boundary-interaction -- Triage deadline wake-up is a process-timer boundary; the exact durable arrival-grace deadline must arm the scheduler.
    expect(requestEmailTriageDrainAtFn).toHaveBeenCalledWith("2026-05-03T12:15:30.000Z");
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

    // test-architecture: allow-boundary-interaction -- Gmail history.list is outbound; exact cursor and page-token framing are provider compatibility inputs not exposed by settled rows.
    expect(fetchHistoryPage).toHaveBeenCalledWith({
      account: expect.objectContaining({ id: "gmail-work" }),
      startHistoryId: "100",
      pageToken: null,
    });
    // test-architecture: allow-boundary-interaction -- Gmail message fetch is outbound; reconciliation must request the exact added IDs projected from the provider history page.
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
    expect(jobs.rows.map((row) => JSON.parse(String(row.payload_json)))).toEqual([
      {
        uid: "gmail-gmail-work-msg-1",
        subject: "One",
        arrivalGrace: true,
        queuedAt: "2026-05-03T12:15:00.000Z",
        graceDeadline: "2026-05-03T12:15:30.000Z",
      },
      {
        uid: "gmail-gmail-work-msg-3",
        subject: "Three",
        arrivalGrace: true,
        queuedAt: "2026-05-03T12:15:00.000Z",
        graceDeadline: "2026-05-03T12:15:30.000Z",
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
});

// triageRetryBackoffIso, reusing the same helper triage-worker.ts uses.
describe("processNextGmailHistorySyncJob bounded retry (CORR-L08)", () => {
  async function seedHistorySyncJob({
    accountId = "gmail-work",
    attempts = 0,
    scheduledFor = null,
    idempotencyKey = "gmail_history_sync:user-1:gmail-work:retry-test",
  } = {}) {
    await testState.db.current.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key,
               priority, payload_json, status, attempts, scheduled_for)
            VALUES (?, ?, NULL, 'gmail_history_sync', ?, 1, ?, 'queued', ?, ?)`,
      args: [
        "user-1",
        accountId,
        idempotencyKey,
        JSON.stringify({ historyId: "200" }),
        attempts,
        scheduledFor,
      ],
    });
  }

  async function loadJobRow() {
    const result = await testState.db.current.execute({
      sql: `SELECT status, attempts, scheduled_for, last_error
            FROM ea_triage_jobs WHERE job_type = 'gmail_history_sync'`,
      args: [],
    });
    return result.rows[0]!;
  }

  it("requeues a transient failure as queued with attempts incremented and scheduled_for in the future", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      user_id: "user-1",
      type: "gmail",
      email: "work@example.com",
      label: "Work",
    });
    await seedHistorySyncJob({ attempts: 0 });
    const now = new Date("2026-05-03T17:00:00.000Z");
    const syncFn = vi.fn(async () => {
      throw new Error("Gmail API 503: temporarily unavailable");
    });
    const logTimingFn = vi.fn();

    await expect(
      gmailSync.processNextGmailHistorySyncJob({
        dbClient: testState.db.current,
        now,
        syncFn,
        timingNow: () => new Date("2026-05-03T17:00:00.500Z"),
        logTimingFn,
      }),
    ).rejects.toThrow("Gmail API 503");

    const row = await loadJobRow();
    expect(row.status).toBe("queued");
    // claimNextHistorySyncJob already incremented attempts 0 -> 1 atomically with
    // the claim; the catch block must not increment it a second time.
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("Gmail API 503: temporarily unavailable");
    expect(new Date(String(row.scheduled_for)).getTime()).toBeGreaterThan(now.getTime());
    // test-architecture: allow-boundary-interaction -- Timing telemetry is the process logging boundary; stage metadata is intentionally not persisted or returned by sync.
    expect(logTimingFn).toHaveBeenCalledWith(expect.objectContaining({
      event: "email-arrival",
      status: "retrying",
      attempts: 1,
      errorKind: "sync_error",
    }));
    expect(JSON.stringify(logTimingFn.mock.calls)).not.toContain("temporarily unavailable");
  });

  it("is not claimable before scheduled_for but is claimable once scheduled_for has passed", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      user_id: "user-1",
      type: "gmail",
      email: "work@example.com",
      label: "Work",
    });
    await seedHistorySyncJob({ attempts: 1 });
    const failAt = new Date("2026-05-03T17:00:00.000Z");
    const syncFn = vi.fn(async () => {
      throw new Error("Gmail API 503: temporarily unavailable");
    });
    await expect(
      gmailSync.processNextGmailHistorySyncJob({ dbClient: testState.db.current, now: failAt, syncFn }),
    ).rejects.toThrow();
    const afterFailure = await loadJobRow();
    const scheduledFor = new Date(String(afterFailure.scheduled_for));

    // Attempt to claim again immediately (before scheduled_for): claim query must
    // skip it, so processNextGmailHistorySyncJob sees nothing to do.
    const tooSoon = new Date(scheduledFor.getTime() - 1000);
    const notClaimedResult = await gmailSync.processNextGmailHistorySyncJob({
      dbClient: testState.db.current,
      now: tooSoon,
      syncFn: vi.fn(),
    });
    expect(notClaimedResult).toEqual({ processed: false });

    // Once scheduled_for has passed, the same job becomes claimable again.
    const afterBackoff = new Date(scheduledFor.getTime() + 1000);
    const successSyncFn = vi.fn(async () => ({ indexed: 0, queued: 0 }));
    const claimedResult = await gmailSync.processNextGmailHistorySyncJob({
      dbClient: testState.db.current,
      now: afterBackoff,
      syncFn: successSyncFn,
    });
    expect(claimedResult.processed).toBe(true);
    // test-architecture: allow-boundary-interaction -- Sync settlement is the durable queue boundary; one claimed job must produce exactly one success transition after reconciliation.
    expect(successSyncFn).toHaveBeenCalledTimes(1);
  });

  it("marks the job terminally failed once the 5th failure is reached, without a scheduled_for requeue", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      user_id: "user-1",
      type: "gmail",
      email: "work@example.com",
      label: "Work",
    });
    // Seed at attempts=4: claimNextHistorySyncJob increments to 5 on claim, which
    // is MAX_GMAIL_HISTORY_SYNC_ATTEMPTS — this failure must be terminal.
    await seedHistorySyncJob({ attempts: 4 });
    const now = new Date("2026-05-03T17:00:00.000Z");
    const syncFn = vi.fn(async () => {
      throw new Error("Gmail API 503: temporarily unavailable");
    });

    await expect(
      gmailSync.processNextGmailHistorySyncJob({ dbClient: testState.db.current, now, syncFn }),
    ).rejects.toThrow("Gmail API 503");

    const row = await loadJobRow();
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(5);
    expect(row.last_error).toBe("Gmail API 503: temporarily unavailable");
  });

  it("fails immediately on invalid_grant and flags the account for reauth, without consuming a retry", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      user_id: "user-1",
      type: "gmail",
      email: "work@example.com",
      label: "Work",
    });
    await seedHistorySyncJob({ attempts: 0 });
    const now = new Date("2026-05-03T17:00:00.000Z");
    const syncFn = vi.fn(async () => {
      throw new Error("invalid_grant: Token has been expired or revoked.");
    });

    await expect(
      gmailSync.processNextGmailHistorySyncJob({ dbClient: testState.db.current, now, syncFn }),
    ).rejects.toThrow("invalid_grant");

    const row = await loadJobRow();
    expect(row.status).toBe("failed");
    expect(row.last_error).toBe("invalid_grant: Token has been expired or revoked.");

    const account = await testState.db.current.execute({
      sql: `SELECT needs_reauth FROM ea_accounts WHERE id = ?`,
      args: ["gmail-work"],
    });
    expect(Number(account.rows[0]!.needs_reauth)).toBe(1);
  });
});
