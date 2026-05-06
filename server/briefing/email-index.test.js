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
const { EMAIL_INDEX_BODY_TEXT_MAX_CHARS } = emailIndex;

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

describe("email indexing", () => {
  it("deduplicates repeated provider rows before writing FTS rowids", async () => {
    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-duplicate",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "First subject",
        body_preview: "First preview",
        body_text: "First body",
        date: "2026-05-01T12:00:00Z",
        read: false,
      },
      {
        uid: "gmail-work-msg-duplicate",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Second subject",
        body_preview: "Second preview",
        body_text: "Second body",
        date: "2026-05-01T12:05:00Z",
        read: true,
      },
    ]);

    const rows = await testState.db.current.execute({
      sql: `SELECT i.subject AS index_subject,
                   i.body_text AS index_body,
                   i.read,
                   COUNT(f.rowid) AS fts_count,
                   MAX(f.subject) AS fts_subject
            FROM ea_email_index i
            LEFT JOIN ea_email_fts f ON f.uid = i.uid AND f.rowid = i.rowid
            WHERE i.uid = ?
            GROUP BY i.uid`,
      args: ["gmail-work-msg-duplicate"],
    });

    expect(rows.rows).toEqual([
      {
        index_subject: "Second subject",
        index_body: "Second body",
        read: 1,
        fts_count: 1,
        fts_subject: "Second subject",
      },
    ]);
  });

  it("updates read state and searchable content when a provider refetch sees an existing email", async () => {
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-1",
      subject: "Original subject",
      body_snippet: "Original preview",
      body_text: "Original body",
      read: 0,
    });

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-1",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Updated subject",
        body_preview: "Updated preview",
        body_text: "Updated body",
        date: "2026-05-01T12:00:00Z",
        read: true,
      },
    ]);

    const indexed = await testState.db.current.execute({
      sql: `SELECT subject, body_snippet, body_text, read
            FROM ea_email_index
            WHERE uid = ?`,
      args: ["gmail-work-msg-1"],
    });
    expect(indexed.rows[0]).toEqual({
      subject: "Updated subject",
      body_snippet: "Updated preview",
      body_text: "Updated body",
      read: 1,
    });

    const fts = await testState.db.current.execute({
      sql: `SELECT subject, body_snippet, body_text
            FROM ea_email_fts
            WHERE uid = ?`,
      args: ["gmail-work-msg-1"],
    });
    expect(fts.rows).toEqual([
      {
        subject: "Updated subject",
        body_snippet: "Updated preview",
        body_text: "Updated body",
      },
    ]);
  });

  it("caps oversized body text before writing index and FTS rows", async () => {
    const bodyText = "x".repeat(EMAIL_INDEX_BODY_TEXT_MAX_CHARS + 25);

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-large",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Large body",
        body_preview: "Large preview",
        body_text: bodyText,
        date: "2026-05-01T12:00:00Z",
        read: false,
      },
    ]);

    const indexed = await testState.db.current.execute({
      sql: `SELECT length(body_text) AS body_length
            FROM ea_email_index
            WHERE uid = ?`,
      args: ["gmail-work-msg-large"],
    });
    const fts = await testState.db.current.execute({
      sql: `SELECT length(body_text) AS body_length
            FROM ea_email_fts
            WHERE uid = ?`,
      args: ["gmail-work-msg-large"],
    });

    expect(Number(indexed.rows[0].body_length)).toBe(EMAIL_INDEX_BODY_TEXT_MAX_CHARS);
    expect(Number(fts.rows[0].body_length)).toBe(EMAIL_INDEX_BODY_TEXT_MAX_CHARS);
  });

  it("skips DB writes when refetched email index content is unchanged", async () => {
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-unchanged",
      subject: "Same subject",
      body_snippet: "Same preview",
      body_text: "Same body",
      read: 1,
    });
    const dbClient = {
      execute: (...args) => testState.db.current.execute(...args),
      batch: vi.fn((...args) => testState.db.current.batch(...args)),
    };

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-unchanged",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Same subject",
        body_preview: "Same preview",
        body_text: "Same body",
        date: "2026-05-01T12:00:00Z",
        read: true,
      },
    ], { dbClient });

    expect(dbClient.batch).not.toHaveBeenCalled();
  });

  it("updates read state without rewriting unchanged FTS content", async () => {
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-read-only",
      subject: "Same subject",
      body_snippet: "Same preview",
      body_text: "Same body",
      read: 0,
    });
    const dbClient = {
      execute: (...args) => testState.db.current.execute(...args),
      batch: vi.fn((...args) => testState.db.current.batch(...args)),
    };

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-read-only",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Same subject",
        body_preview: "Same preview",
        body_text: "Same body",
        date: "2026-05-01T12:00:00Z",
        read: true,
      },
    ], { dbClient });

    const statements = dbClient.batch.mock.calls.flatMap(([batch]) => batch);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("UPDATE ea_email_index");
    expect(statements[0].sql).not.toContain("ea_email_fts");
    const indexed = await testState.db.current.execute({
      sql: "SELECT read FROM ea_email_index WHERE uid = ?",
      args: ["gmail-work-msg-read-only"],
    });
    expect(indexed.rows[0].read).toBe(1);
  });

  it("keeps FTS rowids aligned with email index rowids across content updates", async () => {
    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-rowid",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Original subject",
        body_preview: "Original preview",
        body_text: "Original body",
        date: "2026-05-01T12:00:00Z",
        read: false,
      },
    ]);

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-rowid",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Updated subject",
        body_preview: "Updated preview",
        body_text: "Updated body",
        date: "2026-05-01T12:00:00Z",
        read: false,
      },
    ]);

    const rows = await testState.db.current.execute({
      sql: `SELECT i.rowid AS index_rowid,
                   f.rowid AS fts_rowid,
                   f.subject,
                   f.body_text
            FROM ea_email_index i
            JOIN ea_email_fts f ON f.uid = i.uid
            WHERE i.uid = ?`,
      args: ["gmail-work-msg-rowid"],
    });

    expect(rows.rows).toEqual([
      {
        index_rowid: rows.rows[0].index_rowid,
        fts_rowid: rows.rows[0].index_rowid,
        subject: "Updated subject",
        body_text: "Updated body",
      },
    ]);
  });

  it("replaces changed FTS content by rowid instead of scanning by uid", async () => {
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-rowid-delete",
      subject: "Original subject",
      body_snippet: "Original preview",
      body_text: "Original body",
      read: 0,
    });
    const dbClient = {
      execute: (...args) => testState.db.current.execute(...args),
      batch: vi.fn((...args) => testState.db.current.batch(...args)),
    };

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-rowid-delete",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Updated subject",
        body_preview: "Updated preview",
        body_text: "Updated body",
        date: "2026-05-01T12:00:00Z",
        read: false,
      },
    ], { dbClient });

    const statements = dbClient.batch.mock.calls.flatMap(([batch]) => batch);
    const ftsDelete = statements.find((statement) => statement.sql.includes("DELETE FROM ea_email_fts"));
    expect(ftsDelete?.sql).toContain("WHERE rowid = ?");
    expect(ftsDelete?.sql).not.toContain("WHERE uid = ?");
  });

  it("logs indexing with a scoped current-system prefix", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await emailIndex.indexEmails("user-1", [
        {
          uid: "gmail-work-msg-2",
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#123456",
          account_icon: "Mail",
          from: "Sender <sender@example.com>",
          subject: "Updated subject",
          body_preview: "Updated preview",
          body_text: "Updated body",
          date: "2026-05-01T12:00:00Z",
          read: false,
        },
      ]);

      expect(logSpy).toHaveBeenCalledWith("[EA Index] Indexed 1 email(s)");
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringMatching(/^\[EA\] Indexed .* emails$/));
    } finally {
      logSpy.mockRestore();
    }
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
