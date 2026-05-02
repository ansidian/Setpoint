import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = {
  execute: vi.fn(),
  batch: vi.fn(),
};

vi.mock("../db/connection.js", () => ({ default: mockDb }));

const emailIndex = await import("./email-index.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("email index health", () => {
  it("returns per-account index and backfill state without exposing bodies", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [
          { id: "gmail-work", label: "Work", email: "work@example.com", type: "gmail" },
          { id: "icloud-main", label: "iCloud", email: "me@icloud.com", type: "icloud" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: "gmail-work",
            indexed_count: 42,
            oldest_indexed_date: "2026-01-03T12:00:00Z",
            newest_indexed_date: "2026-05-01T08:00:00Z",
            last_indexed_at: "2026-05-02 10:00:00",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: "gmail-work",
            mailbox_scope: "inbox",
            status: "queued",
            target_days: 365,
            oldest_target_date: "2025-05-02",
            oldest_indexed_date: "2026-01-03T12:00:00Z",
            last_scanned_at: "2026-05-02T15:00:00Z",
            cursor_json: "{\"currentWindow\":{\"start\":\"2026-04-25\",\"end\":\"2026-05-02\"}}",
            indexed_count: 7,
            last_error: "",
            attempts: 2,
            started_at: "2026-05-02 09:00:00",
            completed_at: null,
            updated_at: "2026-05-02 10:00:00",
          },
        ],
      });

    const result = await emailIndex.getEmailIndexHealth("user-1");

    expect(result.accounts).toEqual([
      expect.objectContaining({
        account_id: "gmail-work",
        label: "Work",
        indexed_count: 42,
        oldest_indexed_date: "2026-01-03T12:00:00Z",
        newest_indexed_date: "2026-05-01T08:00:00Z",
        last_indexed_at: "2026-05-02 10:00:00",
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
  });
});

describe("email index backfill trigger", () => {
  it("queues backfill state for every configured email account without fetching mail", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        { id: "gmail-work", label: "Work", email: "work@example.com", type: "gmail" },
        { id: "notes", label: "Notes", email: "", type: "notes" },
        { id: "icloud-main", label: "iCloud", email: "me@icloud.com", type: "icloud" },
      ],
    });
    mockDb.batch.mockResolvedValueOnce({ rows: [] });

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
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
    expect(mockDb.batch.mock.calls[0][0]).toHaveLength(2);
    expect(mockDb.batch.mock.calls[0][0][0].sql).toMatch(/INSERT INTO ea_email_backfill_state/);
  });
});
