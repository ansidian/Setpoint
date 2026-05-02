import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
const gmailApi = vi.hoisted(() => ({ fetchEmailsInRange: vi.fn() }));
const icloudApi = vi.hoisted(() => ({ fetchEmailsInRange: vi.fn() }));
const emailIndexApi = vi.hoisted(() => ({
  indexEmails: vi.fn(),
  queueEmailIndexBackfill: vi.fn(),
}));

vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("./gmail.js", () => ({ fetchEmailsInRange: gmailApi.fetchEmailsInRange }));
vi.mock("./icloud.js", () => ({ fetchEmailsInRange: icloudApi.fetchEmailsInRange }));
vi.mock("./email-index.js", () => ({
  indexEmails: emailIndexApi.indexEmails,
  queueEmailIndexBackfill: emailIndexApi.queueEmailIndexBackfill,
}));
vi.mock("./encryption.js", () => ({ decrypt: vi.fn(() => "icloud-password") }));

const worker = await import("./email-backfill-worker.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function queuedState(overrides = {}) {
  return {
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
}

describe("processNextBackfillWindow", () => {
  it("processes one newest-to-oldest Gmail window and persists progress", async () => {
    const email = { uid: "gmail-gmail-work-msg-1", subject: "Backfill" };
    mockDb.execute
      .mockResolvedValueOnce({ rows: [queuedState()] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: "gmail-work",
          user_id: "user-1",
          type: "gmail",
          email: "work@example.com",
          label: "Work",
        }],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 });
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
    expect(emailIndexApi.indexEmails).toHaveBeenCalledWith("user-1", [email]);
    const finalUpdate = mockDb.execute.mock.calls.at(-1)[0];
    expect(finalUpdate.sql).toMatch(/status = \?/);
    expect(finalUpdate.args[0]).toBe("queued");
    expect(JSON.parse(finalUpdate.args[1])).toMatchObject({
      nextWindowEnd: "2026-04-25T12:00:00.000Z",
      currentWindow: {
        start: "2026-04-25T12:00:00.000Z",
        end: "2026-05-02T12:00:00.000Z",
      },
    });
    expect(finalUpdate.args[2]).toBe(1);
    expect(result).toMatchObject({
      processed: true,
      status: "queued",
      indexed: 1,
    });
  });

  it("keeps the same Gmail window when a provider page token remains", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [queuedState()] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "gmail-work", user_id: "user-1", type: "gmail" }] })
      .mockResolvedValueOnce({ rowsAffected: 1 });
    gmailApi.fetchEmailsInRange.mockResolvedValueOnce({
      emails: [],
      nextPageToken: "page-2",
      resultSizeEstimate: 10,
    });

    await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const cursor = JSON.parse(mockDb.execute.mock.calls.at(-1)[0].args[1]);
    expect(cursor.nextWindowEnd).toBe("2026-05-02T12:00:00.000Z");
    expect(cursor.pageToken).toBe("page-2");
  });

  it("pauses auth failures instead of hot-looping", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [queuedState()] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "gmail-work", user_id: "user-1", type: "gmail" }] })
      .mockResolvedValueOnce({ rowsAffected: 1 });
    gmailApi.fetchEmailsInRange.mockRejectedValueOnce(new Error("Gmail range list failed: 401"));

    const result = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const failureUpdate = mockDb.execute.mock.calls.at(-1)[0];
    expect(failureUpdate.args[0]).toBe("paused");
    expect(failureUpdate.args[2]).toBe("Gmail range list failed: 401");
    expect(result).toMatchObject({ processed: true, status: "paused" });
  });

  it("marks transient failures retryable with attempts incremented", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [queuedState({ attempts: 1 })] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "gmail-work", user_id: "user-1", type: "gmail" }] })
      .mockResolvedValueOnce({ rowsAffected: 1 });
    gmailApi.fetchEmailsInRange.mockRejectedValueOnce(new Error("Gmail range list failed: 503"));

    const result = await worker.processNextBackfillWindow({ now: new Date("2026-05-02T12:00:00Z") });

    const failureUpdate = mockDb.execute.mock.calls.at(-1)[0];
    expect(failureUpdate.args[0]).toBe("retry");
    expect(failureUpdate.args[3]).toBe(2);
    expect(result).toMatchObject({ processed: true, status: "retry" });
  });
});

describe("resumeInterruptedBackfills", () => {
  it("returns interrupted running jobs to retryable state on startup", async () => {
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 2 });

    await worker.resumeInterruptedBackfills();

    expect(mockDb.execute).toHaveBeenCalledWith({
      sql: expect.stringMatching(/UPDATE ea_email_backfill_state/),
      args: [],
    });
  });
});
