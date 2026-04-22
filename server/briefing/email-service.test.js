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
    expect(storedBriefingService.markEmailsRead).toHaveBeenCalledWith("u1", [gmailUid]);
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
});
