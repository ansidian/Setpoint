import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../db/connection.js", () => ({ default: mockDb }));
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
vi.mock("./stored-briefing-service.js", () => ({
  markEmailsRead: vi.fn(),
  markEmailsUnread: vi.fn(),
  removeDismissedEmailFromBriefing: vi.fn(),
}));
vi.mock("./index.js", () => ({ loadUserConfig: vi.fn() }));

const gmail = await import("./gmail.js");
const icloud = await import("./icloud.js");
const storedBriefingService = await import("./stored-briefing-service.js");
const emailService = await import("./email-service.js");
const { __testing__ } = emailService;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockReset();
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
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          uid: "gmail-work-historical-1",
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#123456",
          account_icon: "Mail",
          from_name: "Historical Sender",
          from_address: "sender@example.com",
          subject: "Tuition receipt from last semester",
          body_snippet: "Historical indexed receipt",
          email_date: "2025-09-03T12:00:00Z",
          read: 1,
          subject_highlight: "<mark>Tuition</mark> receipt from last semester",
          body_highlight: "Historical indexed receipt",
          rank: -1.25,
        },
      ],
    });

    const result = await emailService.searchEmails("user-1", {
      q: "tuition receipt",
      limit: 5,
    });

    const query = mockDb.execute.mock.calls[0][0];
    expect(query.sql).toMatch(/FROM ea_email_fts/);
    expect(query.sql).toMatch(/JOIN ea_email_index idx ON idx.uid = ea_email_fts.uid/);
    expect(query.sql).not.toMatch(/ea_briefings|briefing_json|live/i);
    expect(query.args).toEqual([`"tuition" "receipt"*`, "user-1", 90]);
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
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    await emailService.searchEmails("user-1", {
      q: "is:unread amazon",
      limit: 5,
    });

    const query = mockDb.execute.mock.calls[0][0];
    expect(query.sql).toMatch(/ea_email_fts MATCH \?/);
    expect(query.sql).toMatch(/idx\.read = \?/);
    expect(query.args).toEqual([`"amazon"*`, "user-1", 0, 90]);
  });

  it("supports flag-only unread searches without requiring FTS text", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          uid: "gmail-work-unread-1",
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#123456",
          account_icon: "Mail",
          from_name: "Sender",
          from_address: "sender@example.com",
          subject: "Unread note",
          body_snippet: "Needs attention",
          email_date: "2026-05-01T12:00:00Z",
          read: 0,
          subject_highlight: null,
          body_highlight: null,
          rank: 0,
        },
      ],
    });

    const result = await emailService.searchEmails("user-1", {
      q: "is:unread",
      limit: 5,
    });

    const query = mockDb.execute.mock.calls[0][0];
    expect(query.sql).not.toMatch(/ea_email_fts MATCH/);
    expect(query.sql).toMatch(/FROM ea_email_index idx/);
    expect(query.sql).toMatch(/idx\.read = \?/);
    expect(query.args).toEqual(["user-1", 0, 90]);
    expect(result.accounts[0].results[0].read).toBe(false);
  });

  it("supports is:read as an indexed read predicate", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    await emailService.searchEmails("user-1", {
      q: "is:read invoice",
      limit: 5,
    });

    const query = mockDb.execute.mock.calls[0][0];
    expect(query.sql).toMatch(/idx\.read = \?/);
    expect(query.args).toEqual([`"invoice"*`, "user-1", 1, 90]);
  });

  it("returns indexed search results newest to oldest", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          uid: "older",
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#123456",
          account_icon: "Mail",
          from_name: "Sender",
          from_address: "sender@example.com",
          subject: "Older invoice",
          body_snippet: "Older indexed result",
          email_date: "2026-04-01T12:00:00Z",
          read: 1,
          subject_highlight: null,
          body_highlight: null,
          rank: -20,
        },
        {
          uid: "newer",
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          account_color: "#123456",
          account_icon: "Mail",
          from_name: "Sender",
          from_address: "sender@example.com",
          subject: "Newer invoice",
          body_snippet: "Newer indexed result",
          email_date: "2026-05-01T12:00:00Z",
          read: 1,
          subject_highlight: null,
          body_highlight: null,
          rank: -1,
        },
      ],
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
    expect(storedBriefingService.markEmailsRead).not.toHaveBeenCalled();
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
    expect(storedBriefingService.markEmailsRead).not.toHaveBeenCalled();
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
    expect(storedBriefingService.markEmailsRead).not.toHaveBeenCalled();
  });
});
