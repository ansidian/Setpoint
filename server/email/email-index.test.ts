import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
  seedIndexedEmail,
} from "./test-utils/email-index-db.ts";

const testState = vi.hoisted(() => ({
  db: { current: null as unknown as Client },
}));

// test-architecture: allow-boundary-mock -- Email-index behavior executes real migrations and SQL against an ephemeral libSQL client redirected through the production singleton seam.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => testState.db.current.execute(statement),
    batch: (statements: InStatement[], mode?: TransactionMode) => testState.db.current.batch(statements, mode),
  },
}));

const emailIndex = await import("./email-index.ts");

beforeEach(async () => {
  testState.db.current = await createEmailIndexTestDb();
});

afterEach(async () => {
  testState.db.current.close();
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
        oldest_indexed_date: "2026-01-03T12:00:00.000Z",
        newest_indexed_date: "2026-05-01T08:00:00.000Z",
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

  it("routes a snippet-only drift through the cheap metadata update, not an FTS rewrite (P3-2)", async () => {
    const base = {
      uid: "gmail-work-msg-snippet",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      account_color: "#123456",
      account_icon: "Mail",
      from: "Sender <sender@example.com>",
      subject: "Stable subject",
      body_text: "Stable body",
      date: "2026-05-01T12:00:00.000Z",
      read: true,
    };
    // Baseline index establishes every column, including the normalized date.
    await emailIndex.indexEmails("user-1", [{ ...base, body_preview: "Old preview" }]);
    // Stand in for the search embedding the re-embedding worker would compute:
    // a snippet-only drift must NOT invalidate it (the snippet is not part of
    // the searchable-content set), unlike a real subject/body change.
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_search_embeddings
              (uid, user_id, account_id, document_text, document_json,
               source_hash, document_version, embedding_model,
               embedding_dimensions, embedding)
            VALUES (?, ?, ?, ?, ?, ?, 1, 'text-embedding-3-small', 1536, ?)`,
      args: [
        "gmail-work-msg-snippet",
        "user-1",
        "gmail-work",
        "Subject: Stable subject",
        JSON.stringify({ subject: "Stable subject" }),
        "fresh-hash",
        Buffer.from(new Float32Array([0.1, 0.2]).buffer),
      ],
    });

    // A re-fetch sees only a drifted Gmail snippet — everything else identical.
    await emailIndex.indexEmails("user-1", [{ ...base, body_preview: "New preview" }]);

    // The volatile preview is refreshed in the index row...
    const indexed = await testState.db.current.execute({
      sql: "SELECT body_snippet FROM ea_email_index WHERE uid = ?",
      args: ["gmail-work-msg-snippet"],
    });
    expect(indexed.rows[0]!.body_snippet).toBe("New preview");
    // ...while the searchable FTS content is left untouched (no FTS rewrite)...
    const fts = await testState.db.current.execute({
      sql: "SELECT subject, body_snippet, body_text FROM ea_email_fts WHERE uid = ?",
      args: ["gmail-work-msg-snippet"],
    });
    expect(fts.rows).toEqual([
      { subject: "Stable subject", body_snippet: "Old preview", body_text: "Stable body" },
    ]);
    // ...and the search embedding survives (no re-embedding triggered).
    const embedding = await testState.db.current.execute({
      sql: "SELECT source_hash FROM ea_email_search_embeddings WHERE uid = ?",
      args: ["gmail-work-msg-snippet"],
    });
    expect(embedding.rows).toEqual([{ source_hash: "fresh-hash" }]);
  });

  it("backfills identity via the cheap metadata update, not an FTS rewrite (D2)", async () => {
    const base = {
      uid: "gmail-work-msg-identity-backfill",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      account_color: "#123456",
      account_icon: "Mail",
      from: "Sender <sender@example.com>",
      subject: "Stable subject",
      body_text: "Stable body",
      date: "2026-05-01T12:00:00.000Z",
      read: true,
    };
    // Baseline rows predate the identity columns (indexed without ids).
    await emailIndex.indexEmails("user-1", [{ ...base, body_preview: "Old preview" }]);
    // Stand in for the search embedding: an identity backfill must NOT
    // invalidate it — identity is metadata, not searchable content.
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_search_embeddings
              (uid, user_id, account_id, document_text, document_json,
               source_hash, document_version, embedding_model,
               embedding_dimensions, embedding)
            VALUES (?, ?, ?, ?, ?, ?, 1, 'text-embedding-3-small', 1536, ?)`,
      args: [
        "gmail-work-msg-identity-backfill",
        "user-1",
        "gmail-work",
        "Subject: Stable subject",
        JSON.stringify({ subject: "Stable subject" }),
        "fresh-hash",
        Buffer.from(new Float32Array([0.1, 0.2]).buffer),
      ],
    });

    // A re-fetch now carries the ids (and a drifted snippet) — content identical.
    await emailIndex.indexEmails("user-1", [{
      ...base,
      body_preview: "New preview",
      thread_id: "t-888",
      message_id: "<m-888@example.com>",
    }]);

    const indexed = await testState.db.current.execute({
      sql: "SELECT thread_id, message_id, body_snippet FROM ea_email_index WHERE uid = ?",
      args: ["gmail-work-msg-identity-backfill"],
    });
    expect(indexed.rows).toEqual([
      { thread_id: "t-888", message_id: "<m-888@example.com>", body_snippet: "New preview" },
    ]);
    // The FTS row keeps the pre-backfill snippet: no FTS rewrite happened.
    const fts = await testState.db.current.execute({
      sql: "SELECT body_snippet FROM ea_email_fts WHERE uid = ?",
      args: ["gmail-work-msg-identity-backfill"],
    });
    expect(fts.rows).toEqual([{ body_snippet: "Old preview" }]);
    // And the embedding survives (no invalidation).
    const embedding = await testState.db.current.execute({
      sql: "SELECT source_hash FROM ea_email_search_embeddings WHERE uid = ?",
      args: ["gmail-work-msg-identity-backfill"],
    });
    expect(embedding.rows).toEqual([{ source_hash: "fresh-hash" }]);
  });

  it("normalizes provider email dates for temporal search without rewriting unchanged FTS content", async () => {
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-date",
      subject: "Same subject",
      body_snippet: "Same preview",
      body_text: "Same body",
      email_date: "2026-05-01T12:00:00.000Z",
      read: 1,
    });

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-date",
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "work@example.com",
        account_color: "#123456",
        account_icon: "Mail",
        from: "Sender <sender@example.com>",
        subject: "Same subject",
        body_preview: "Same preview",
        body_text: "Same body",
        date: "Thu, 14 May 2026 18:11:11 +0000",
        read: true,
      },
    ]);

    const indexed = await testState.db.current.execute({
      sql: "SELECT email_date, email_date_utc FROM ea_email_index WHERE uid = ?",
      args: ["gmail-work-msg-date"],
    });
    expect(indexed.rows[0]).toEqual({
      email_date: "Thu, 14 May 2026 18:11:11 +0000",
      email_date_utc: "2026-05-14T18:11:11.000Z",
    });
    // Date drift rides the cheap metadata update: the searchable FTS content
    // is left untouched rather than being rewritten.
    const fts = await testState.db.current.execute({
      sql: "SELECT subject, body_snippet, body_text FROM ea_email_fts WHERE uid = ?",
      args: ["gmail-work-msg-date"],
    });
    expect(fts.rows).toEqual([
      { subject: "Same subject", body_snippet: "Same preview", body_text: "Same body" },
    ]);
  });

  it("replaces stale FTS content when a uid appears after the preflight read", async () => {
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-reassigned",
      subject: "Previous subject",
      body_snippet: "Previous preview",
      body_text: "Previous body",
    });
    const dbClient = {
      execute: vi.fn((query: string | InStatement) => {
        if (typeof query !== "string" && query.sql.includes("SELECT rowid, uid")) {
          return Promise.resolve({ rows: [] });
        }
        return testState.db.current.execute(query);
      }),
      batch: (statements: InStatement[], mode?: TransactionMode) => testState.db.current.batch(statements, mode),
    };

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-reassigned",
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

    const rows = await testState.db.current.execute({
      sql: `SELECT i.user_id,
                   i.subject AS index_subject,
                   COUNT(f.rowid) AS fts_count,
                   MAX(f.subject) AS fts_subject
            FROM ea_email_index i
            LEFT JOIN ea_email_fts f ON f.uid = i.uid AND f.rowid = i.rowid
            WHERE i.uid = ?
            GROUP BY i.uid`,
      args: ["gmail-work-msg-reassigned"],
    });

    expect(rows.rows).toEqual([
      {
        user_id: "user-1",
        index_subject: "Updated subject",
        fts_count: 1,
        fts_subject: "Updated subject",
      },
    ]);
  });

  it("invalidates the stale search embedding when searchable content changes", async () => {
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-embedded",
      subject: "Original subject",
      body_snippet: "Original preview",
      body_text: "Original body",
      read: 1,
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_search_embeddings
              (uid, user_id, account_id, document_text, document_json,
               source_hash, document_version, embedding_model,
               embedding_dimensions, embedding)
            VALUES (?, ?, ?, ?, ?, ?, 1, 'text-embedding-3-small', 1536, ?)`,
      args: [
        "gmail-work-msg-embedded",
        "user-1",
        "gmail-work",
        "Subject: Original subject",
        JSON.stringify({ subject: "Original subject" }),
        "stale-hash",
        Buffer.from(new Float32Array([0.1, 0.2]).buffer),
      ],
    });

    await emailIndex.indexEmails("user-1", [
      {
        uid: "gmail-work-msg-embedded",
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

    const embeddingRows = await testState.db.current.execute({
      sql: "SELECT uid FROM ea_email_search_embeddings WHERE uid = ?",
      args: ["gmail-work-msg-embedded"],
    });
    // Row deleted -> the re-embedding worker re-selects it as a missing
    // candidate and recomputes the vector against the new content.
    expect(embeddingRows.rows).toHaveLength(0);
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
