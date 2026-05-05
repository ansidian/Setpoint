import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailIndexTestDb,
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
        rows: [{ account_id: "gmail-legacy", account_email: "dup@example.com" }],
      });

    const out = await __testing__.findAccountByUid("u1", "gmail-gmail-legacy-msg123");

    expect(out.account.id).toBe("gmail-fresh");
    expect(out.account.uid_account_id).toBe("gmail-legacy");
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

    expect(result).toEqual({
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
    });
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

  it("routes legacy Gmail UID prefixes through the canonical account for batch updates", async () => {
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
