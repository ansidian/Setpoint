import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const emailIndex = await import("./email-index.js");

beforeEach(async () => {
  testState.db.current = await createEmailIndexTestDb();
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("email index health", () => {
  it("returns per-account index and backfill state without exposing bodies", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      label: "Work",
      email: "work@example.com",
      type: "gmail",
      sort_order: 1,
    });
    await seedEmailAccount(testState.db.current, {
      id: "icloud-main",
      label: "iCloud",
      email: "me@icloud.com",
      type: "icloud",
      sort_order: 2,
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-1",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      subject: "Tuition receipt",
      body_text: "Private full body text should never be returned by health.",
      email_date: "2026-01-03T12:00:00Z",
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-2",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      subject: "May invoice",
      email_date: "2026-05-01T08:00:00Z",
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_backfill_state
              (user_id, account_id, mailbox_scope, status, target_days,
               oldest_target_date, oldest_indexed_date, last_scanned_at,
               cursor_json, indexed_count, last_error, attempts,
               started_at, updated_at)
            VALUES (?, ?, 'inbox', 'queued', 365, '2025-05-02',
                    '2026-01-03T12:00:00Z', '2026-05-02T15:00:00Z',
                    ?, 7, '', 2, '2026-05-02 09:00:00',
                    '2026-05-02 10:00:00')`,
      args: [
        "user-1",
        "gmail-work",
        JSON.stringify({ currentWindow: { start: "2026-04-25", end: "2026-05-02" } }),
      ],
    });

    const result = await emailIndex.getEmailIndexHealth("user-1");

    expect(result.accounts).toEqual([
      expect.objectContaining({
        account_id: "gmail-work",
        label: "Work",
        indexed_count: 2,
        oldest_indexed_date: "2026-01-03T12:00:00Z",
        newest_indexed_date: "2026-05-01T08:00:00Z",
        last_indexed_at: expect.any(String),
        backfill: expect.objectContaining({
          mailbox_scope: "inbox",
          status: "queued",
          target_days: 365,
          current_window: { start: "2026-04-25", end: "2026-05-02" },
          attempts: 2,
          last_error: "",
        }),
      }),
      expect.objectContaining({
        account_id: "icloud-main",
        indexed_count: 0,
        oldest_indexed_date: null,
        newest_indexed_date: null,
        last_indexed_at: null,
        backfill: expect.objectContaining({
          status: "not_started",
          target_days: null,
        }),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("body_text");
    expect(JSON.stringify(result)).not.toContain("Private full body text");
  });
});

describe("email index backfill trigger", () => {
  it("queues backfill state for every configured email account without fetching mail", async () => {
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      label: "Work",
      email: "work@example.com",
      type: "gmail",
      sort_order: 1,
    });
    await seedEmailAccount(testState.db.current, {
      id: "notes",
      label: "Notes",
      email: "notes@example.com",
      type: "notes",
      sort_order: 2,
    });
    await seedEmailAccount(testState.db.current, {
      id: "icloud-main",
      label: "iCloud",
      email: "me@icloud.com",
      type: "icloud",
      sort_order: 3,
    });

    const result = await emailIndex.queueEmailIndexBackfill("user-1", {
      targetDays: 180,
      now: new Date("2026-05-02T12:00:00Z"),
    });

    expect(result).toEqual({
      queued: true,
      mailbox_scope: "inbox",
      target_days: 180,
      oldest_target_date: "2025-11-03",
      accounts: [
        expect.objectContaining({ account_id: "gmail-work", status: "queued" }),
        expect.objectContaining({ account_id: "icloud-main", status: "queued" }),
      ],
    });

    const rows = await testState.db.current.execute({
      sql: `SELECT account_id, status, target_days, oldest_target_date,
                   cursor_json, attempts, completed_at
            FROM ea_email_backfill_state
            WHERE user_id = ?
            ORDER BY account_id`,
      args: ["user-1"],
    });
    expect(rows.rows).toEqual([
      {
        account_id: "gmail-work",
        status: "queued",
        target_days: 180,
        oldest_target_date: "2025-11-03",
        cursor_json: "{}",
        attempts: 0,
        completed_at: null,
      },
      {
        account_id: "icloud-main",
        status: "queued",
        target_days: 180,
        oldest_target_date: "2025-11-03",
        cursor_json: "{}",
        attempts: 0,
        completed_at: null,
      },
    ]);
  });
});
