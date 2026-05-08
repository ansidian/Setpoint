import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
  seedIndexedEmail,
} from "./test-utils/email-index-db.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));
const mockDb = { execute: vi.fn() };
vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => mockDb.execute(...args),
  },
}));
vi.mock("./encryption.js", () => ({ decrypt: () => "decrypted" }));
vi.mock("./gmail.js", () => ({
  fetchEmailBody: vi.fn(),
  markAsRead: vi.fn(),
  markAsUnread: vi.fn(),
  trashMessage: vi.fn(),
  batchMarkAsRead: vi.fn(),
  snoozeAtGmail: vi.fn(),
  wakeAtGmail: vi.fn(),
}));
vi.mock("./icloud.js", () => ({
  fetchEmailBody: vi.fn(),
  markAsRead: vi.fn(),
  markAsUnread: vi.fn(),
  trashMessage: vi.fn(),
  batchMarkAsRead: vi.fn(),
}));
vi.mock("./config-service.js", () => ({ loadUserConfig: vi.fn() }));

const gmail = await import("./gmail.js");
const icloud = await import("./icloud.js");
const configService = await import("./config-service.js");
const emailService = await import("./email-service.js");
const { __testing__ } = emailService;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockReset();
  mockDb.execute.mockImplementation((...args) => testState.db.current?.execute(...args));
  testState.db.current = null;
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("findAccountByUid", () => {
  it("returns icloud account for icloud- prefix", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "icloud-1", email: "x@icloud.com" }] });
    const out = await __testing__.findAccountByUid("u1", "icloud-abc");
    expect(out).toEqual({ type: "icloud", account: { id: "icloud-1", email: "x@icloud.com" } });
  });

  it("prefers the indexed iCloud account when the uid is ambiguous", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "icloud-work", email: "work@icloud.com", type: "icloud" }],
    });
    const out = await __testing__.findAccountByUid("u1", "icloud-abc");
    expect(out).toEqual({
      type: "icloud",
      account: { id: "icloud-work", email: "work@icloud.com", type: "icloud" },
    });
  });

  it("returns gmail account matching accountId prefix for gmail- uids", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        { id: "gmail-y@z.com", email: "y@z.com" },
        { id: "gmail-q@r.com", email: "q@r.com" },
      ],
    });
    const out = await __testing__.findAccountByUid("u1", "gmail-gmail-y@z.com-msg123");
    expect(out.account.id).toBe("gmail-y@z.com");
  });

  it("routes duplicate Gmail prefixes through the canonical account credentials", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        { id: "gmail-old", email: "dup@example.com", updated_at: "2026-04-18T10:00:00Z" },
        { id: "gmail-fresh", email: "dup@example.com", updated_at: "2026-04-20T10:00:00Z" },
      ],
    });

    const out = await __testing__.findAccountByUid("u1", "gmail-gmail-old-msg123");

    expect(out.account.id).toBe("gmail-fresh");
    expect(out.account.uid_account_id).toBe("gmail-old");
    expect(out.account.canonical_id).toBe("gmail-fresh");
  });

  it("falls back through indexed account_email when no Gmail prefix row matches", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [{ id: "gmail-fresh", email: "dup@example.com", updated_at: "2026-04-20T10:00:00Z" }],
      })
      .mockResolvedValueOnce({
        rows: [{ account_id: "gmail-indexed", account_email: "dup@example.com" }],
      });

    const out = await __testing__.findAccountByUid("u1", "gmail-gmail-indexed-msg123");

    expect(out.account.id).toBe("gmail-fresh");
    expect(out.account.uid_account_id).toBe("gmail-indexed");
  });

  it("returns null for unknown prefix", async () => {
    const out = await __testing__.findAccountByUid("u1", "unknown-xyz");
    expect(out).toBeNull();
  });
});

describe("sanitizeFtsQuery", () => {
  it("quotes each term and wildcards the last", () => {
    expect(__testing__.sanitizeFtsQuery("foo bar")).toBe(`"foo" "bar"*`);
  });

  it("normalizes smart quotes", () => {
    expect(__testing__.sanitizeFtsQuery("\u201cfoo\u201d")).toContain(`"foo`);
  });

  it("falls back to quoted raw on empty-split input", () => {
    expect(__testing__.sanitizeFtsQuery("   ")).toBe(`"   "`);
  });
});

describe("buildEmailWebUrl", () => {
  it("builds a gmail web url for well-formed uids", () => {
    const url = __testing__.buildEmailWebUrl("gmail-gmail-y@z.com-msgABC", "gmail-y@z.com", "y@z.com");
    expect(url).toBe("https://mail.google.com/mail/?authuser=y%40z.com#all/msgABC");
  });

  it("returns null for non-gmail uids", () => {
    expect(__testing__.buildEmailWebUrl("icloud-1", "gmail-x", "x@y.com")).toBeNull();
  });
});

describe("searchEmails contract", () => {
  it("searches the persisted email index instead of latest briefing/live payloads", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-historical-1",
      from_name: "Historical Sender",
      from_address: "sender@example.com",
      subject: "Tuition receipt from last semester",
      body_snippet: "Historical indexed receipt",
      body_text: "Historical indexed receipt from last semester",
      email_date: "2025-09-03T12:00:00Z",
      read: 1,
    });

    const result = await emailService.searchEmails("user-1", {
      q: "tuition receipt",
      limit: 5,
    });

    expect(result).toEqual(expect.objectContaining({
      accounts: [
        expect.objectContaining({
          account_id: "gmail-work",
          results: [
            expect.objectContaining({
              uid: "gmail-work-historical-1",
              subject: "Tuition receipt from last semester",
              email_date: "2025-09-03T12:00:00Z",
              read: true,
            }),
          ],
        }),
      ],
      total: 1,
      query: "tuition receipt",
    }));
    expect(result.results).toEqual([
      expect.objectContaining({
        uid: "gmail-work-historical-1",
        account_id: "gmail-work",
        account_label: "Work",
      }),
    ]);
  });

  it("combines is:unread with full-text search against indexed read state", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedIndexedEmail(testState.db.current, {
      uid: "unread-amazon",
      subject: "Amazon delivery",
      body_text: "Amazon package update",
      read: 0,
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "read-amazon",
      subject: "Amazon receipt",
      body_text: "Amazon receipt",
      read: 1,
    });

    const result = await emailService.searchEmails("user-1", {
      q: "is:unread amazon",
      limit: 5,
    });

    expect(result.total).toBe(1);
    expect(result.accounts[0].results).toEqual([
      expect.objectContaining({
        uid: "unread-amazon",
        read: false,
      }),
    ]);
  });

  it("supports flag-only unread searches without requiring FTS text", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-unread-1",
      subject: "Unread note",
      body_snippet: "Needs attention",
      read: 0,
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-read-1",
      subject: "Read note",
      body_snippet: "Already handled",
      read: 1,
    });

    const result = await emailService.searchEmails("user-1", {
      q: "is:unread",
      limit: 5,
    });

    expect(result.total).toBe(1);
    expect(result.accounts[0].results[0].uid).toBe("gmail-work-unread-1");
    expect(result.accounts[0].results[0].read).toBe(false);
  });

  it("smart-ranks flag-only unread searches by usefulness and recency", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedIndexedEmail(testState.db.current, {
      uid: "newer-unread-noise",
      subject: "Newsletter",
      body_snippet: "Unread promotion",
      email_date: "2026-05-07T12:00:00Z",
      read: 0,
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "older-unread-bill",
      subject: "Payment required",
      body_snippet: "Unread bill",
      email_date: "2026-04-28T12:00:00Z",
      read: 0,
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, bill_candidate_json, triage_status)
            VALUES (?, ?, ?, 'needs_attention', 'finance', 'high', ?, 'complete')`,
      args: ["user-1", "gmail-work", "older-unread-bill", JSON.stringify({ amount_due: 25 })],
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, triage_status)
            VALUES (?, ?, ?, 'noise', 'promotions', 'low', 'complete')`,
      args: ["user-1", "gmail-work", "newer-unread-noise"],
    });

    const result = await emailService.searchEmails("user-1", {
      q: "is:unread",
      limit: 5,
    });

    expect(result.results.map((email) => email.uid)).toEqual([
      "older-unread-bill",
      "newer-unread-noise",
    ]);
  });

  it("supports is:read as an indexed read predicate", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedIndexedEmail(testState.db.current, {
      uid: "read-invoice",
      subject: "Read invoice",
      body_text: "Invoice paid",
      read: 1,
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "unread-invoice",
      subject: "Unread invoice",
      body_text: "Invoice due",
      read: 0,
    });

    const result = await emailService.searchEmails("user-1", {
      q: "is:read invoice",
      limit: 5,
    });

    expect(result.total).toBe(1);
    expect(result.accounts[0].results).toEqual([
      expect.objectContaining({
        uid: "read-invoice",
        read: true,
      }),
    ]);
  });

  it("returns indexed search results newest to oldest", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedIndexedEmail(testState.db.current, {
      uid: "older",
      subject: "Older invoice",
      body_snippet: "Older indexed result",
      body_text: "Older invoice result",
      email_date: "2026-04-01T12:00:00Z",
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "newer",
      subject: "Newer invoice",
      body_snippet: "Newer indexed result",
      body_text: "Newer invoice result",
      email_date: "2026-05-01T12:00:00Z",
    });

    const result = await emailService.searchEmails("user-1", {
      q: "invoice",
      limit: 5,
    });

    expect(result.accounts[0].results.map((email) => email.uid)).toEqual(["newer", "older"]);
  });

  it("returns top-level smart-ranked results while keeping grouped account results", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-personal-newer-noise",
      account_id: "gmail-personal",
      account_label: "Personal",
      account_email: "personal@example.com",
      from_name: "Promotions",
      from_address: "deals@example.com",
      subject: "Weekend digest",
      body_snippet: "Tuition receipt appears in the body only.",
      body_text: "Tuition receipt appears in the body only.",
      email_date: "2026-05-06T12:00:00Z",
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-older-finance",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "work@example.com",
      from_name: "Bursar Office",
      from_address: "billing@school.edu",
      subject: "Tuition receipt ready",
      body_snippet: "Payment confirmation attached.",
      body_text: "Payment confirmation attached.",
      email_date: "2026-04-20T12:00:00Z",
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, deadline_at, triage_status)
            VALUES (?, ?, ?, 'needs_attention', 'finance', 'high', ?, 'complete')`,
      args: ["user-1", "gmail-work", "gmail-work-older-finance", "2026-05-10T16:00:00Z"],
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, lane, category, urgency, triage_status)
            VALUES (?, ?, ?, 'noise', 'promotions', 'low', 'complete')`,
      args: ["user-1", "gmail-personal", "gmail-personal-newer-noise"],
    });

    const result = await emailService.searchEmails("user-1", {
      q: "tuition receipt",
      limit: 5,
    });

    expect(result.results.map((email) => email.uid)).toEqual([
      "gmail-work-older-finance",
      "gmail-personal-newer-noise",
    ]);
    expect(result.accounts.flatMap((account) => account.results).map((email) => email.uid)).toEqual([
      "gmail-work-older-finance",
      "gmail-personal-newer-noise",
    ]);
  });

  it("includes search scoring details only for explicit debug searches", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedIndexedEmail(testState.db.current, {
      uid: "debug-invoice",
      subject: "Invoice due",
      body_text: "Invoice due",
    });

    const normal = await emailService.searchEmails("user-1", {
      q: "invoice",
      limit: 5,
    });
    const debug = await emailService.searchEmails("user-1", {
      q: "invoice",
      limit: 5,
      debug: true,
    });

    expect(normal.results[0]).not.toHaveProperty("search_score");
    expect(normal.results[0]).not.toHaveProperty("search_score_details");
    expect(debug.results[0]).toEqual(expect.objectContaining({
      search_score: expect.any(Number),
      search_score_details: expect.objectContaining({
        details: expect.any(Array),
      }),
    }));
  });

  it("rejects unsupported flag-like search tokens", async () => {
    await expect(emailService.searchEmails("user-1", {
      q: "is:important amazon",
      limit: 5,
    })).rejects.toMatchObject({
      status: 400,
      code: "unsupported_email_search_flag",
      message: "Unsupported email search flag: is:important",
    });
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});

describe("pending triage action semantics", () => {
  it("dismiss durably skips pending triage rows and completes queued jobs", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await testState.db.current.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status)
            VALUES (?, ?, ?, 'pending')`,
      args: ["user-1", "gmail-work", "gmail-work-msg-1"],
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', 'queued', ?)`,
      args: [
        "user-1",
        "gmail-work",
        "gmail-work-msg-1",
        "email_triage:user-1:gmail-work:gmail-work-msg-1",
      ],
    });

    await emailService.dismiss("user-1", "gmail-work-msg-1");

    const rows = await testState.db.current.execute({
      sql: `SELECT d.email_id,
                   t.dismissed_at,
                   t.triage_status,
                   t.triage_source,
                   j.status,
                   j.scheduled_for,
                   j.last_error
            FROM ea_dismissed_emails d
            JOIN ea_email_triage t ON t.user_id = d.user_id AND t.email_id = d.email_id
            JOIN ea_triage_jobs j ON j.user_id = d.user_id AND j.email_id = d.email_id
            WHERE d.user_id = ? AND d.email_id = ?`,
      args: ["user-1", "gmail-work-msg-1"],
    });

    expect(rows.rows).toEqual([
      expect.objectContaining({
        email_id: "gmail-work-msg-1",
        dismissed_at: expect.any(String),
        triage_status: "skipped",
        triage_source: "user_dismissed_pending",
        status: "complete",
        scheduled_for: null,
        last_error: "Skipped pending triage; user dismissed row",
      }),
    ]);
  });

  it("snooze hides active pending rows and defers queued triage until wake", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await seedEmailAccount(testState.db.current, {
      id: "gmail-work",
      email: "work@example.com",
    });
    await seedIndexedEmail(testState.db.current, {
      uid: "gmail-work-msg-1",
      account_id: "gmail-work",
      account_email: "work@example.com",
    });
    const snapshot = await testState.db.current.execute({
      sql: `INSERT INTO ea_briefing_snapshots
              (user_id, start_at, end_at, timezone, status)
            VALUES (?, ?, ?, 'America/Los_Angeles', 'active')
            RETURNING id`,
      args: ["user-1", "2026-05-03T07:00:00.000Z", "2026-05-04T07:00:00.000Z"],
    });
    const triage = await testState.db.current.execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status)
            VALUES (?, ?, ?, 'pending')
            RETURNING id`,
      args: ["user-1", "gmail-work", "gmail-work-msg-1"],
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
               urgency_at_snapshot, category_at_snapshot, subject_at_snapshot)
            VALUES (?, ?, ?, ?, ?, 'needs_attention', '', '', 'normal', 'uncategorized', 'Pending')`,
      args: [
        snapshot.rows[0].id,
        triage.rows[0].id,
        "user-1",
        "gmail-work",
        "gmail-work-msg-1",
      ],
    });
    await testState.db.current.execute({
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, status, idempotency_key)
            VALUES (?, ?, ?, 'email_triage', 'queued', ?)`,
      args: [
        "user-1",
        "gmail-work",
        "gmail-work-msg-1",
        "email_triage:user-1:gmail-work:gmail-work-msg-1",
      ],
    });
    configService.loadUserConfig.mockResolvedValue({
      accounts: [{ id: "gmail-work", email: "work@example.com", type: "gmail" }],
    });
    const untilTs = Date.parse("2026-05-04T16:00:00.000Z");

    await emailService.snooze("user-1", "gmail-work-msg-1", untilTs, {
      account_id: "gmail-work",
      account_email: "work@example.com",
      uid: "gmail-work-msg-1",
      subject: "Pending",
    });

    expect(gmail.snoozeAtGmail).toHaveBeenCalledWith(
      { id: "gmail-work", email: "work@example.com", type: "gmail" },
      "gmail-work-msg-1",
    );
    const rows = await testState.db.current.execute({
      sql: `SELECT s.status AS snooze_status,
                   s.until_ts,
                   t.triage_status,
                   t.triage_source,
                   i.dismissed_from_today_at,
                   j.status AS job_status,
                   j.scheduled_for,
                   j.last_error
            FROM ea_snoozed_emails s
            JOIN ea_email_triage t ON t.user_id = s.user_id AND t.email_id = s.email_id
            JOIN ea_briefing_snapshot_items i ON i.user_id = s.user_id AND i.email_id = s.email_id
            JOIN ea_triage_jobs j ON j.user_id = s.user_id AND j.email_id = s.email_id
            WHERE s.user_id = ? AND s.email_id = ?`,
      args: ["user-1", "gmail-work-msg-1"],
    });

    expect(rows.rows).toEqual([
      expect.objectContaining({
        snooze_status: "snoozed",
        until_ts: untilTs,
        triage_status: "pending",
        triage_source: "user_snoozed_pending",
        dismissed_from_today_at: expect.any(String),
        job_status: "queued",
        scheduled_for: "2026-05-04T16:00:00.000Z",
        last_error: "Deferred pending triage while snoozed",
      }),
    ]);

    await emailService.wake("user-1", "gmail-work-msg-1");

    expect(gmail.wakeAtGmail).toHaveBeenCalledWith(
      { id: "gmail-work", email: "work@example.com", type: "gmail" },
      "gmail-work-msg-1",
    );
    const restoredRows = await testState.db.current.execute({
      sql: `SELECT s.status AS snooze_status,
                   t.triage_status,
                   t.triage_source,
                   i.dismissed_from_today_at,
                   j.status AS job_status,
                   j.scheduled_for,
                   j.completed_at,
                   j.last_error
            FROM ea_email_triage t
            LEFT JOIN ea_snoozed_emails s ON s.user_id = t.user_id AND s.email_id = t.email_id
            JOIN ea_briefing_snapshot_items i ON i.user_id = t.user_id AND i.email_id = t.email_id
            JOIN ea_triage_jobs j ON j.user_id = t.user_id AND j.email_id = t.email_id
            WHERE t.user_id = ? AND t.email_id = ?`,
      args: ["user-1", "gmail-work-msg-1"],
    });
    expect(restoredRows.rows).toEqual([
      expect.objectContaining({
        snooze_status: null,
        triage_status: "pending",
        triage_source: "undo_restored_pending",
        dismissed_from_today_at: null,
        job_status: "queued",
        scheduled_for: null,
        completed_at: null,
        last_error: "",
      }),
    ]);
  });
});

describe("markAllRead", () => {
  it("updates successful UID groups and reports partial failures", async () => {
    const gmailUid = "gmail-gmail-work-msg1";
    const icloudUid = "icloud-3193";
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [
          { id: "gmail-work", email: "work@example.com", type: "gmail" },
          { id: "icloud-main", email: "me@icloud.com", type: "icloud", credentials_encrypted: "enc" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ uid: icloudUid, account_id: "icloud-main" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    gmail.batchMarkAsRead.mockResolvedValueOnce(undefined);
    icloud.batchMarkAsRead.mockRejectedValueOnce(new Error("iCloud batch failed"));

    const result = await emailService.markAllRead("u1", [gmailUid, icloudUid]);

    expect(result).toEqual({
      updatedUids: [gmailUid],
      failed: [{
        provider: "icloud",
        uids: [icloudUid],
        message: "iCloud batch failed",
      }],
    });
    expect(mockDb.execute).toHaveBeenLastCalledWith({
      sql: "UPDATE ea_email_index SET read = 1 WHERE user_id = ? AND uid IN (?)",
      args: ["u1", gmailUid],
    });
  });

  it("throws when every provider batch update fails", async () => {
    const gmailUid = "gmail-gmail-work-msg1";
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "gmail-work", email: "work@example.com", type: "gmail" }],
    });
    gmail.batchMarkAsRead.mockRejectedValueOnce(new Error("Gmail batch failed"));

    await expect(emailService.markAllRead("u1", [gmailUid])).rejects.toMatchObject({
      message: "Gmail batch failed",
      code: "email_mark_all_read_failed",
      status: 502,
    });
  });

  it("routes stale Gmail UID prefixes through the canonical account for batch updates", async () => {
    const gmailUid = "gmail-gmail-old-msg1";
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        { id: "gmail-old", email: "dup@example.com", type: "gmail", updated_at: "2026-04-18T10:00:00Z" },
        { id: "gmail-fresh", email: "dup@example.com", type: "gmail", updated_at: "2026-04-20T10:00:00Z" },
      ],
    });
    gmail.batchMarkAsRead.mockResolvedValueOnce(undefined);

    const result = await emailService.markAllRead("u1", [gmailUid]);

    expect(result).toEqual({ updatedUids: [gmailUid], failed: [] });
    expect(gmail.batchMarkAsRead).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "gmail-fresh",
        canonical_id: "gmail-fresh",
        uid_account_id: "gmail-old",
      }),
      [gmailUid],
    );
  });
});
