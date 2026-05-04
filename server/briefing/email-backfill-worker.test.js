import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
} from "./test-utils/email-index-db.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));
const gmailApi = vi.hoisted(() => ({ fetchEmailsInRange: vi.fn() }));
const icloudApi = vi.hoisted(() => ({ fetchEmailsInRange: vi.fn() }));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));
vi.mock("./gmail.js", () => ({ fetchEmailsInRange: gmailApi.fetchEmailsInRange }));
vi.mock("./icloud.js", () => ({ fetchEmailsInRange: icloudApi.fetchEmailsInRange }));
vi.mock("./encryption.js", () => ({ decrypt: vi.fn(() => "icloud-password") }));

const worker = await import("./email-backfill-worker.js");

beforeEach(async () => {
  testState.db.current = await createEmailIndexTestDb();
  gmailApi.fetchEmailsInRange.mockReset();
  icloudApi.fetchEmailsInRange.mockReset();
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

async function seedBackfillState(overrides = {}) {
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
  return result.rows[0];
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
    expect(JSON.parse(state.cursor_json)).toMatchObject({
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
    expect(JSON.parse(state.cursor_json)).toMatchObject({
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
