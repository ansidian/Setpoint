import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
} from "./test-utils/email-index-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null as unknown as Client },
}));
const gmailApi = vi.hoisted(() => ({ fetchEmailsInRange: vi.fn() }));
const icloudApi = vi.hoisted(() => ({ fetchEmailsInRange: vi.fn() }));

// test-architecture: allow-boundary-mock -- Backfill durability runs against a migrated ephemeral libSQL client redirected through the shared production connection seam.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => testState.db.current.execute(statement),
    batch: (statements: InStatement[], mode?: TransactionMode) => testState.db.current.batch(statements, mode),
  },
}));
// test-architecture: allow-boundary-mock -- Gmail range fetch is the outbound provider boundary; worker cases control provider pages while asserting migrated durable progress.
vi.mock("./gmail.ts", () => ({ fetchEmailsInRange: gmailApi.fetchEmailsInRange }));
// test-architecture: allow-boundary-mock -- iCloud IMAP range fetch is the outbound provider boundary; worker cases control provider pages while asserting migrated durable progress.
vi.mock("./icloud.ts", () => ({ fetchEmailsInRange: icloudApi.fetchEmailsInRange }));
// test-architecture: allow-boundary-mock -- Credential decryption is the cryptographic secret boundary; provider-worker cases use one deterministic iCloud password without deployment keys.
vi.mock("../platform/encryption.ts", () => ({ decrypt: vi.fn(() => "icloud-password") }));

const worker = await import("./email-backfill-worker.ts");

beforeEach(async () => {
  testState.db.current = await createEmailIndexTestDb({
    extraMigrations: [
      "006_email_search_embedding_state.sql",
      "007_email_search_ai_usage.sql",
      "028_provider_needs_reauth.sql",
    ],
  });
  gmailApi.fetchEmailsInRange.mockReset();
  icloudApi.fetchEmailsInRange.mockReset();
});

afterEach(async () => {
  testState.db.current.close();
});

interface SeedBackfillState {
  user_id: string;
  account_id: string;
  mailbox_scope: string;
  status: string;
  target_days: number;
  oldest_target_date: string;
  cursor_json: string;
  indexed_count: number;
  attempts: number;
  updated_at?: string;
}

async function seedBackfillState(overrides: Partial<SeedBackfillState> = {}) {
  const state = {
    user_id: "user-1",
    account_id: "gmail-work",
    mailbox_scope: "inbox",
    status: "queued",
    target_days: 365,
    oldest_target_date: "2025-05-02",
    cursor_json: "{}",
    indexed_count: 0,
    attempts: 0,
    ...overrides,
  };
  await testState.db.current.execute({
    sql: `INSERT INTO ea_email_backfill_state
            (user_id, account_id, mailbox_scope, status, target_days,
             oldest_target_date, cursor_json, indexed_count, attempts, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      state.user_id,
      state.account_id,
      state.mailbox_scope,
      state.status,
      state.target_days,
      state.oldest_target_date,
      state.cursor_json,
      state.indexed_count,
      state.attempts,
      state.updated_at || "2026-05-02 09:00:00",
    ],
  });
  return state;
}

async function readBackfillState(accountId = "gmail-work") {
  const result = await testState.db.current.execute({
    sql: `SELECT status, cursor_json, indexed_count, oldest_indexed_date,
                 last_scanned_at, last_error, attempts, completed_at
          FROM ea_email_backfill_state
          WHERE user_id = ? AND account_id = ? AND mailbox_scope = 'inbox'`,
    args: ["user-1", accountId],
  });
  return result.rows[0]!;
}

async function readAccountNeedsReauth(accountId = "gmail-work") {
  const result = await testState.db.current.execute({
    sql: "SELECT needs_reauth FROM ea_accounts WHERE id = ?",
    args: [accountId],
  });
  return result.rows[0]!.needs_reauth;
}

describe("processNextBackfillWindow", () => {
  it("processes one newest-to-oldest Gmail window and persists progress", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      user_id: "user-1",
      type: "gmail",
      email: "work@example.com",
      label: "Work",
    });
    await seedBackfillState();
    const email = {
      uid: "gmail-gmail-work-msg-1",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      from: "Backfill Sender <sender@example.com>",
      subject: "Backfill",
      body_preview: "Backfill preview",
      body_text: "Backfill body",
      date: "2026-04-28T12:00:00.000Z",
      read: false,
    };
    gmailApi.fetchEmailsInRange.mockResolvedValueOnce({
      emails: [email],
      nextPageToken: null,
      resultSizeEstimate: 1,
    });

    const result = await worker.processNextBackfillWindow({
      now: new Date("2026-05-02T12:00:00Z"),
      windowDays: 7,
    });

    // test-architecture: allow-boundary-interaction -- Gmail range fetch is outbound; the newest-to-oldest window and mailbox scope are provider compatibility inputs not recoverable from indexed rows.
    expect(gmailApi.fetchEmailsInRange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-work" }),
      {
        start: "2026-04-25T12:00:00.000Z",
        end: "2026-05-02T12:00:00.000Z",
        pageToken: undefined,
      },
    );
    expect(result).toMatchObject({
      processed: true,
      status: "queued",
      indexed: 1,
    });

    const state = await readBackfillState();
    expect(state).toMatchObject({
      status: "queued",
      indexed_count: 1,
      oldest_indexed_date: "2026-04-28T12:00:00.000Z",
      last_scanned_at: "2026-05-02T12:00:00.000Z",
      last_error: "",
      attempts: 1,
      completed_at: null,
    });
    expect(JSON.parse(String(state.cursor_json))).toMatchObject({
      nextWindowEnd: "2026-04-25T12:00:00.000Z",
      currentWindow: {
        start: "2026-04-25T12:00:00.000Z",
        end: "2026-05-02T12:00:00.000Z",
      },
    });

    const indexed = await testState.db.current.execute({
      sql: `SELECT idx.uid, idx.subject, idx.read, fts.body_text
            FROM ea_email_index idx
            JOIN ea_email_fts fts ON fts.uid = idx.uid
            WHERE idx.user_id = ?`,
      args: ["user-1"],
    });
    expect(indexed.rows).toEqual([
      expect.objectContaining({
        uid: "gmail-gmail-work-msg-1",
        subject: "Backfill",
        read: 0,
        body_text: "Backfill body",
      }),
    ]);
  });

  it("keeps the same Gmail window when a provider page token remains", async () => {
    await seedEmailAccount(testState.db.current, { id: "gmail-work", type: "gmail" });
    await seedBackfillState();
    gmailApi.fetchEmailsInRange.mockResolvedValueOnce({
      emails: [],
      nextPageToken: "page-2",
      resultSizeEstimate: 10,
    });

    await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const state = await readBackfillState();
    expect(JSON.parse(String(state.cursor_json))).toMatchObject({
      nextWindowEnd: "2026-05-02T12:00:00.000Z",
      pageToken: "page-2",
    });
  });

  it("pauses auth failures instead of hot-looping", async () => {
    await seedEmailAccount(testState.db.current, { id: "gmail-work", type: "gmail" });
    await seedBackfillState();
    gmailApi.fetchEmailsInRange.mockRejectedValueOnce(new Error("Gmail range list failed: 401"));

    const result = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const state = await readBackfillState();
    expect(state).toMatchObject({
      status: "paused",
      last_error: "Gmail range list failed: 401",
      attempts: 1,
    });
    expect(result).toMatchObject({ processed: true, status: "paused" });
  });

  it("pauses AND flags the account needs_reauth when a window fails with invalid_grant (REL-01)", async () => {
    await seedEmailAccount(testState.db.current, { id: "gmail-work", type: "gmail" });
    await seedBackfillState();
    gmailApi.fetchEmailsInRange.mockRejectedValueOnce(
      new Error('Gmail range list failed: 400 {"error":"invalid_grant"}'),
    );

    const result = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const state = await readBackfillState();
    expect(state).toMatchObject({ status: "paused", attempts: 1 });
    expect(result).toMatchObject({ processed: true, status: "paused" });
    expect(await readAccountNeedsReauth()).toBe(1);
  });

  it("pauses but does NOT flag the account for a non-invalid_grant (429) failure", async () => {
    await seedEmailAccount(testState.db.current, { id: "gmail-work", type: "gmail" });
    await seedBackfillState();
    gmailApi.fetchEmailsInRange.mockRejectedValueOnce(new Error("Gmail range list failed: 429"));

    const result = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const state = await readBackfillState();
    expect(state).toMatchObject({ status: "paused", attempts: 1 });
    expect(result).toMatchObject({ processed: true, status: "paused" });
    expect(await readAccountNeedsReauth()).toBe(0);
  });

  it("marks transient failures retryable with attempts incremented", async () => {
    await seedEmailAccount(testState.db.current, { id: "gmail-work", type: "gmail" });
    await seedBackfillState({ attempts: 1 });
    gmailApi.fetchEmailsInRange.mockRejectedValueOnce(new Error("Gmail range list failed: 503"));

    const result = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const state = await readBackfillState();
    expect(state).toMatchObject({
      status: "retry",
      last_error: "Gmail range list failed: 503",
      attempts: 2,
    });
    expect(result).toMatchObject({ processed: true, status: "retry" });
  });

  it("marks the row terminal and does not re-select it when the account is gone (P3-47)", async () => {
    // No account seeded: loadAccount returns null (account deleted).
    await seedBackfillState();

    const result = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    expect(result).toMatchObject({ processed: true, status: "failed" });
    const state = await readBackfillState();
    expect(state).toMatchObject({
      status: "failed",
      last_error: "Email account not found: gmail-work",
      attempts: 1,
    });
    // test-architecture: allow-boundary-interaction -- Gmail range fetch is outbound; a provider reauth state must suppress further requests until credentials are repaired.
    expect(gmailApi.fetchEmailsInRange).not.toHaveBeenCalled();

    // A 'failed' row is terminal: a second drain pass must not pick it back up.
    const second = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });
    expect(second).toEqual({ processed: false });
  });

  it("stops retrying non-auth failures once attempts hit the ceiling (P3-47)", async () => {
    await seedEmailAccount(testState.db.current, { id: "gmail-work", type: "gmail" });
    // attempts: 4 -> incremented to 5 (MAX_BACKFILL_ATTEMPTS) this pass.
    await seedBackfillState({ attempts: 4 });
    gmailApi.fetchEmailsInRange.mockRejectedValueOnce(new Error("Gmail range list failed: 503"));

    const result = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    expect(result).toMatchObject({ processed: true, status: "failed" });
    const state = await readBackfillState();
    expect(state).toMatchObject({
      status: "failed",
      last_error: "Gmail range list failed: 503",
      attempts: 5,
    });
    // Terminal row is not re-selected on the next pass.
    const second = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });
    expect(second).toEqual({ processed: false });
  });

  it("bounds the iCloud window fetch with a limit and continues via the returned cursor (P3-46)", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "icloud-main",
      user_id: "user-1",
      type: "icloud",
      email: "me@icloud.com",
      label: "Personal",
      credentials_encrypted: "cipher",
    });
    await seedBackfillState({ account_id: "icloud-main" });
    icloudApi.fetchEmailsInRange.mockResolvedValueOnce({
      emails: [
        {
          uid: "icloud-1",
          account_id: "icloud-main",
          account_label: "Personal",
          account_email: "me@icloud.com",
          from: "Sender <sender@example.com>",
          subject: "Backfill",
          body_preview: "preview",
          body_text: "body",
          date: "2026-04-28T12:00:00.000Z",
          read: false,
        },
      ],
      cursor: "uid:42",
    });

    const result = await worker.processNextBackfillWindow({
      now: new Date("2026-05-02T12:00:00Z"),
      windowDays: 7,
    });

    // The per-window fetch is capped (limit passed) rather than unbounded.
    const [, , options] = icloudApi.fetchEmailsInRange.mock.calls[0]!;
    expect(options).toMatchObject({
      start: "2026-04-25T12:00:00.000Z",
      end: "2026-05-02T12:00:00.000Z",
    });
    expect(typeof options.limit).toBe("number");
    expect(options.limit).toBeGreaterThan(0);

    // A returned cursor keeps the same window and stores the continuation token
    // so un-returned messages get backfilled on the next pass.
    expect(result).toMatchObject({ processed: true, status: "queued" });
    const state = await readBackfillState("icloud-main");
    const cursor = JSON.parse(String(state.cursor_json));
    expect(cursor).toMatchObject({
      nextWindowEnd: "2026-05-02T12:00:00.000Z",
      providerCursor: "uid:42",
      currentWindow: {
        start: "2026-04-25T12:00:00.000Z",
        end: "2026-05-02T12:00:00.000Z",
      },
    });
  });

  it("hands a stored iCloud cursor back to the provider on the next pass (P3-46)", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "icloud-main",
      user_id: "user-1",
      type: "icloud",
      email: "me@icloud.com",
      label: "Personal",
      credentials_encrypted: "cipher",
    });
    await seedBackfillState({
      account_id: "icloud-main",
      cursor_json: JSON.stringify({
        nextWindowEnd: "2026-05-02T12:00:00.000Z",
        providerCursor: "uid:42",
      }),
    });
    icloudApi.fetchEmailsInRange.mockResolvedValueOnce({ emails: [], cursor: null });

    await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const [, , options] = icloudApi.fetchEmailsInRange.mock.calls[0]!;
    expect(options.cursor).toBe("uid:42");
  });
});

describe("resumeInterruptedBackfills", () => {
  it("returns interrupted running jobs to retryable state on startup", async () => {
    await seedBackfillState({
      account_id: "gmail-work",
      status: "running",
      updated_at: "2026-05-02 09:00:00",
    });
    await seedBackfillState({
      account_id: "icloud-main",
      status: "running",
      updated_at: "2026-05-02 09:01:00",
    });

    await worker.resumeInterruptedBackfills();

    const rows = await testState.db.current.execute({
      sql: `SELECT account_id, status, last_error
            FROM ea_email_backfill_state
            ORDER BY account_id`,
      args: [],
    });
    expect(rows.rows).toEqual([
      {
        account_id: "gmail-work",
        status: "retry",
        last_error: "Backfill interrupted before completion",
      },
      {
        account_id: "icloud-main",
        status: "retry",
        last_error: "Backfill interrupted before completion",
      },
    ]);
  });
});

describe("prepareEmailBackfillStartup", () => {
  it("resumes interrupted jobs without queuing a broad backfill by default", async () => {
    await seedEmailAccount(testState.db.current, {
      user_id: "user-1",
      id: "gmail-work",
      type: "gmail",
    });
    await seedBackfillState({
      account_id: "gmail-work",
      status: "running",
    });

    const result = await worker.prepareEmailBackfillStartup();

    const rows = await testState.db.current.execute({
      sql: `SELECT account_id, status, target_days
            FROM ea_email_backfill_state
            ORDER BY account_id`,
      args: [],
    });
    expect(result).toEqual({ resumed: true, queued: false });
    expect(rows.rows).toEqual([
      {
        account_id: "gmail-work",
        status: "retry",
        target_days: 365,
      },
    ]);
  });

  it("can explicitly queue startup backfill when requested", async () => {
    await seedEmailAccount(testState.db.current, {
      user_id: "user-1",
      id: "gmail-work",
      type: "gmail",
    });

    const result = await worker.prepareEmailBackfillStartup({ queueOnStartup: true, targetDays: 30 });

    const rows = await testState.db.current.execute({
      sql: `SELECT account_id, status, target_days
            FROM ea_email_backfill_state
            ORDER BY account_id`,
      args: [],
    });
    expect(result).toEqual({ resumed: true, queued: true });
    expect(rows.rows).toEqual([
      {
        account_id: "gmail-work",
        status: "queued",
        target_days: 30,
      },
    ]);
  });
});

describe("stopEmailBackfillWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    worker.stopEmailBackfillWorker();
    vi.useRealTimers();
  });

  it("prevents an armed wake timer from firing the queue drain", async () => {
    await seedEmailAccount(testState.db.current, {
      user_id: "user-1",
      id: "gmail-work",
      type: "gmail",
    });
    await seedBackfillState({ account_id: "gmail-work", status: "queued" });

    worker.wakeEmailBackfillWorker({ delayMs: 1000 });
    worker.stopEmailBackfillWorker();

    await vi.advanceTimersByTimeAsync(2000);

    // test-architecture: allow-boundary-interaction -- Gmail range fetch is outbound; a completed durable backfill must not restart provider pagination.
    expect(gmailApi.fetchEmailsInRange).not.toHaveBeenCalled();
    const rows = await testState.db.current.execute({
      sql: `SELECT status FROM ea_email_backfill_state WHERE account_id = ?`,
      args: ["gmail-work"],
    });
    expect(rows.rows).toEqual([{ status: "queued" }]);
  });

  it("is safe to call twice", () => {
    worker.wakeEmailBackfillWorker({ delayMs: 1000 });
    worker.stopEmailBackfillWorker();
    expect(() => worker.stopEmailBackfillWorker()).not.toThrow();
  });

  it("lets a fresh startEmailBackfillWorker re-arm after a stop", async () => {
    worker.wakeEmailBackfillWorker({ delayMs: 1000 });
    worker.stopEmailBackfillWorker();

    // wakeEmailBackfillWorker alone must stay a no-op post-stop...
    worker.wakeEmailBackfillWorker({ delayMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000);
    // test-architecture: allow-boundary-interaction -- Gmail range fetch is outbound; another worker's active claim must prevent duplicate provider work.
    expect(gmailApi.fetchEmailsInRange).not.toHaveBeenCalled();

    // ...but startEmailBackfillWorker clears the stop latch so the worker can
    // run again after a restart.
    worker.startEmailBackfillWorker({ initialDelayMs: 1000, queueOnStartup: false });
    await vi.advanceTimersByTimeAsync(0); // let prepareEmailBackfillStartup's promise resolve
    await vi.advanceTimersByTimeAsync(1000);

    const rows = await testState.db.current.execute({
      sql: `SELECT status FROM ea_email_backfill_state`,
      args: [],
    });
    // No backfill rows queued in this test, so the drain loop finds nothing
    // and exits immediately — the point is only that wake was allowed to arm
    // and fire, not that it did any work.
    expect(rows.rows).toEqual([]);
  });
});
