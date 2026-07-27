import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, ResultSet } from "@libsql/client";
import type * as EmailProviderAdapters from "./email-provider-adapters.ts";
import {
  createEmailIndexTestDb,
  seedEmailAccount,
  seedIndexedEmail,
} from "./test-utils/email-index-db.ts";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));
const mockDb = { execute: vi.fn<(statement: string | InStatement) => unknown>() };

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

function executeCurrent(statement: string | InStatement): Promise<ResultSet> {
  return typeof statement === "string"
    ? currentDb().execute(statement)
    : currentDb().execute(statement);
}
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => mockDb.execute(statement),
  },
}));
vi.mock("../platform/encryption.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, decrypt: () => "decrypted" };
});
vi.mock("./gmail.ts", () => ({
  fetchEmailBody: vi.fn(),
  markAsRead: vi.fn(),
  markAsUnread: vi.fn(),
  trashMessage: vi.fn(),
  batchMarkAsRead: vi.fn(),
  snoozeAtGmail: vi.fn(),
  wakeAtGmail: vi.fn(),
}));
vi.mock("./icloud.ts", () => ({
  fetchEmailBody: vi.fn(),
  markAsRead: vi.fn(),
  markAsUnread: vi.fn(),
  trashMessage: vi.fn(),
  batchMarkAsRead: vi.fn(),
}));
vi.mock("../platform/config-service.ts", () => ({ loadUserConfig: vi.fn() }));
// Partial mock: keep every real adapter export (including findAccountByUid) and
// override only trashEmailWithProvider
// so the trash() tests can drive provider success/failure deterministically.
vi.mock("./email-provider-adapters.ts", async (importActual) => {
  const actual = await importActual<typeof EmailProviderAdapters>();
  return { ...actual, trashEmailWithProvider: vi.fn() };
});
const gmail = vi.mocked(await import("./gmail.ts"));
const icloud = vi.mocked(await import("./icloud.ts"));
const configService = vi.mocked(await import("../platform/config-service.ts"));
const providerAdapters = vi.mocked(await import("./email-provider-adapters.ts"));
const emailService = await import("./email-service.ts");
const { findAccountByUid } = providerAdapters;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockReset();
  mockDb.execute.mockImplementation((statement) => (
    testState.db.current ? executeCurrent(statement) : undefined
  ));
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
    const out = await findAccountByUid("u1", "icloud-abc");
    expect(out).toEqual({ type: "icloud", account: { id: "icloud-1", email: "x@icloud.com" } });
  });

  it("refuses to guess when multiple iCloud accounts exist and the uid is unindexed (P2-24)", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] }) // index lookup: not found
      .mockResolvedValueOnce({ rows: [
        { id: "icloud-a", email: "a@icloud.com", type: "icloud" },
        { id: "icloud-b", email: "b@icloud.com", type: "icloud" },
      ] });
    // Routing to rows[0] here would mutate the wrong mailbox, so it must refuse.
    await expect(findAccountByUid("u1", "icloud-abc")).rejects.toMatchObject({ status: 404 });
  });

  it("prefers the indexed iCloud account when the uid is ambiguous", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: "icloud-work", email: "work@icloud.com", type: "icloud" }],
    });
    const out = await findAccountByUid("u1", "icloud-abc");
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
    const out = await findAccountByUid("u1", "gmail-gmail-y@z.com-msg123");
    expect(out!.account.id).toBe("gmail-y@z.com");
  });

  it("routes duplicate Gmail prefixes through the canonical account credentials", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        { id: "gmail-old", email: "dup@example.com", updated_at: "2026-04-18T10:00:00Z" },
        { id: "gmail-fresh", email: "dup@example.com", updated_at: "2026-04-20T10:00:00Z" },
      ],
    });

    const out = await findAccountByUid("u1", "gmail-gmail-old-msg123");

    expect(out!.account.id).toBe("gmail-fresh");
    expect(out!.account.uid_account_id).toBe("gmail-old");
    expect(out!.account.canonical_id).toBe("gmail-fresh");
  });

  it("falls back through indexed account_email when no Gmail prefix row matches", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [{ id: "gmail-fresh", email: "dup@example.com", updated_at: "2026-04-20T10:00:00Z" }],
      })
      .mockResolvedValueOnce({
        rows: [{ account_id: "gmail-indexed", account_email: "dup@example.com" }],
      });

    const out = await findAccountByUid("u1", "gmail-gmail-indexed-msg123");

    expect(out!.account.id).toBe("gmail-fresh");
    expect(out!.account.uid_account_id).toBe("gmail-indexed");
  });

  it("returns null for unknown prefix", async () => {
    const out = await findAccountByUid("u1", "unknown-xyz");
    expect(out).toBeNull();
  });
});

describe("pending triage action semantics", () => {
  it("dismiss durably skips pending triage rows and completes queued jobs", async () => {
    testState.db.current = await createEmailIndexTestDb();
    await currentDb().execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status)
            VALUES (?, ?, ?, 'pending')`,
      args: ["user-1", "gmail-work", "gmail-work-msg-1"],
    });
    await currentDb().execute({
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

    const rows = await currentDb().execute({
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
    await seedEmailAccount(currentDb(), {
      id: "gmail-work",
      email: "work@example.com",
    });
    await seedIndexedEmail(currentDb(), {
      uid: "gmail-work-msg-1",
      account_id: "gmail-work",
      account_email: "work@example.com",
    });
    const snapshot = await currentDb().execute({
      sql: `INSERT INTO ea_briefing_snapshots
              (user_id, start_at, end_at, timezone, status)
            VALUES (?, ?, ?, 'America/Los_Angeles', 'active')
            RETURNING id`,
      args: ["user-1", "2026-05-03T07:00:00.000Z", "2026-05-04T07:00:00.000Z"],
    });
    const triage = await currentDb().execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status)
            VALUES (?, ?, ?, 'pending')
            RETURNING id`,
      args: ["user-1", "gmail-work", "gmail-work-msg-1"],
    });
    await currentDb().execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id,
               lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
               urgency_at_snapshot, category_at_snapshot, subject_at_snapshot)
            VALUES (?, ?, ?, ?, ?, 'needs_attention', '', '', 'normal', 'uncategorized', 'Pending')`,
      args: [
        Number(snapshot.rows[0]!.id),
        Number(triage.rows[0]!.id),
        "user-1",
        "gmail-work",
        "gmail-work-msg-1",
      ],
    });
    await currentDb().execute({
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
      accounts: [{ id: "gmail-work", email: "work@example.com", type: "gmail" }] as unknown as Awaited<ReturnType<typeof configService.loadUserConfig>>["accounts"],
      settings: undefined,
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
    const rows = await currentDb().execute({
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
    const restoredRows = await currentDb().execute({
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

describe("snooze atomicity (P3-60)", () => {
  it("rolls back the committed snooze row when the pending-triage defer fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    testState.db.current = await createEmailIndexTestDb();
    await seedEmailAccount(currentDb(), {
      id: "gmail-work",
      email: "work@example.com",
    });
    await seedIndexedEmail(currentDb(), {
      uid: "gmail-work-msg-1",
      account_id: "gmail-work",
      account_email: "work@example.com",
    });
    await currentDb().execute({
      sql: `INSERT INTO ea_email_triage
              (user_id, account_id, email_id, triage_status)
            VALUES (?, ?, ?, 'pending')`,
      args: ["user-1", "gmail-work", "gmail-work-msg-1"],
    });
    configService.loadUserConfig.mockResolvedValue({
      accounts: [{ id: "gmail-work", email: "work@example.com", type: "gmail" }] as unknown as Awaited<ReturnType<typeof configService.loadUserConfig>>["accounts"],
      settings: undefined,
    });

    // Force only the defer helper's pending-triage read to fail; the snooze
    // INSERT and the rollback DELETE must still execute against the real DB.
    mockDb.execute.mockImplementation((arg) => {
      const sql = typeof arg === "string" ? arg : arg?.sql;
      if (
        sql?.includes("decision_metadata_json")
        && sql.includes("FROM ea_email_triage")
        && sql.includes("'pending'")
      ) {
        return Promise.reject(new Error("defer read exploded"));
      }
      return executeCurrent(arg);
    });

    const untilTs = Date.parse("2026-05-04T16:00:00.000Z");
    await expect(
      emailService.snooze("user-1", "gmail-work-msg-1", untilTs, {
        account_id: "gmail-work",
        account_email: "work@example.com",
        uid: "gmail-work-msg-1",
        subject: "Pending",
      }),
    ).rejects.toThrow("defer read exploded");

    // The snooze row must be rolled back, and Gmail snooze-modify must not run
    // (the defer is the gate before the external call).
    const rows = await currentDb().execute({
      sql: "SELECT * FROM ea_snoozed_emails WHERE user_id = ? AND email_id = ?",
      args: ["user-1", "gmail-work-msg-1"],
    });
    expect(rows.rows).toEqual([]);
    expect(gmail.snoozeAtGmail).not.toHaveBeenCalled();
  });
});

describe("trash post-provider cleanup (P3-74)", () => {
  it("does not throw or report trash failed when a post-provider local write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    testState.db.current = await createEmailIndexTestDb();
    providerAdapters.trashEmailWithProvider.mockResolvedValue({
      type: "gmail",
      account: {
        id: "gmail-work",
        type: "gmail",
        email: "work@example.com",
        label: "Work",
        color: "#123456",
        credentials_encrypted: "enc",
      },
      providerAccountId: "gmail-work",
      fetchBody: vi.fn(),
      markRead: vi.fn(),
      markUnread: vi.fn(),
      trash: vi.fn(),
    });

    // The provider trash already committed; force the local snooze-row delete to
    // reject while leaving the snapshot-removal cleanup to run normally.
    let snoozeDeleteAttempted = false;
    mockDb.execute.mockImplementation((arg) => {
      const sql = typeof arg === "string" ? arg : arg?.sql;
      if (sql?.includes("DELETE FROM ea_snoozed_emails")) {
        snoozeDeleteAttempted = true;
        return Promise.reject(new Error("snooze delete exploded"));
      }
      return executeCurrent(arg);
    });

    await expect(
      emailService.trash("user-1", "gmail-work-msg-1"),
    ).resolves.toBeUndefined();

    expect(providerAdapters.trashEmailWithProvider).toHaveBeenCalledWith(
      "user-1",
      "gmail-work-msg-1",
    );
    expect(snoozeDeleteAttempted).toBe(true);
  });
});
