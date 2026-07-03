import { describe, it, expect, vi, beforeEach } from "vitest";

// mock encryption before module load so getValidToken doesn't need real credentials
vi.mock("../platform/encryption.js", () => ({
  decrypt: () => JSON.stringify({
    access_token: "tok",
    refresh_token: "rtok",
    expires_at: Date.now() + 3600_000,
  }),
  encrypt: (s) => s,
}));

// We need to stub global fetch before importing the module
vi.stubGlobal("fetch", vi.fn());

const { chunkArray, fetchMessages, fetchEmailsInRange, archiveMessage, unarchiveMessage } = await import("./gmail.js");

describe("gmail", () => {
  describe("chunkArray", () => {
    it("splits array into chunks of given size", () => {
      expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it("returns empty array for empty input", () => {
      expect(chunkArray([], 10)).toEqual([]);
    });

    it("returns single chunk when array is smaller than chunk size", () => {
      expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
    });
  });

  describe("fetchMessages", () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it("fetches 25 messages in chunks and returns all 25", async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg", payload: {} }),
      });

      const ids = Array.from({ length: 25 }, (_, i) => `id${i}`);
      const results = await fetchMessages("token", ids);

      expect(fetch).toHaveBeenCalledTimes(25);
      expect(results.length).toBe(25);
    });

    it("does not cap input — fetches all 120 IDs", async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg", payload: {} }),
      });

      const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
      const results = await fetchMessages("token", ids);

      expect(fetch).toHaveBeenCalledTimes(120);
      expect(results.length).toBe(120);
    });

    it("logs a warning for each dropped fetch and returns only successes", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "msg2", payload: {} }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValue({
          ok: true,
          json: async () => ({ id: "msgN", payload: {} }),
        });

      const ids = Array.from({ length: 5 }, (_, i) => `id${i}`);
      const results = await fetchMessages("token", ids);

      // First and third calls fail; 3 of 5 succeed
      expect(results.length).toBe(3);
      // 2 per-message warnings + 1 summary warning
      expect(warnSpy).toHaveBeenCalledTimes(3);
      warnSpy.mockRestore();
    });

    it("concatenates results from all chunks in order", async () => {
      let callCount = 0;
      fetch.mockImplementation(() => {
        const idx = callCount++;
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: `msg${idx}`, payload: {} }),
        });
      });

      const ids = Array.from({ length: 12 }, (_, i) => `id${i}`);
      const results = await fetchMessages("token", ids);

      expect(results.length).toBe(12);
      expect(results[0].id).toBe("msg0");
      expect(results[11].id).toBe("msg11");
    });
  });
});

describe("archiveMessage / unarchiveMessage", () => {
  const fakeAccount = {
    id: "acc-1",
    email: "andy@example.com",
    credentials_encrypted: "stub", // decrypt is mocked above
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("archiveMessage POSTs /modify with removeLabelIds INBOX", async () => {
    fetch.mockResolvedValue({ ok: true });
    await archiveMessage(fakeAccount, "18c4e7ab1234");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/messages\/18c4e7ab1234\/modify$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ removeLabelIds: ["INBOX"] });
  });

  it("unarchiveMessage POSTs /modify with addLabelIds INBOX", async () => {
    fetch.mockResolvedValue({ ok: true });
    await unarchiveMessage(fakeAccount, "18c4e7ab1234");
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ addLabelIds: ["INBOX"] });
  });

  it("archiveMessage throws when Gmail returns non-OK", async () => {
    fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(archiveMessage(fakeAccount, "18c4e7ab1234")).rejects.toThrow(/Gmail archive failed: 403/);
  });
});

describe("fetchEmailsInRange", () => {
  const fakeAccount = {
    id: "gmail-work",
    label: "Work",
    email: "work@example.com",
    color: "#123456",
    icon: "Mail",
    credentials_encrypted: "stub",
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches a bounded INBOX date window and returns normalized indexable emails", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [{ id: "msg-1" }],
          nextPageToken: "next-page",
          resultSizeEstimate: 2,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg-1",
          threadId: "t-abc123",
          snippet: "Short preview",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            headers: [
              { name: "From", value: "Sender <sender@example.com>" },
              { name: "Subject", value: "Range message" },
              { name: "Date", value: "Fri, 01 May 2026 10:00:00 -0700" },
              { name: "Message-ID", value: "<msg-1@example.com>" },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: Buffer.from("Full body $12.34", "utf8").toString("base64url") },
              },
            ],
          },
        }),
      });

    const result = await fetchEmailsInRange(fakeAccount, {
      start: "2026-04-25T00:00:00Z",
      end: "2026-05-02T00:00:00Z",
      pageToken: "cursor-1",
      maxResults: 25,
    });

    const listUrl = new URL(fetch.mock.calls[0][0]);
    expect(listUrl.searchParams.get("q")).toBe("after:2026/04/25 before:2026/05/02");
    expect(listUrl.searchParams.get("labelIds")).toBe("INBOX");
    expect(listUrl.searchParams.get("pageToken")).toBe("cursor-1");
    expect(listUrl.searchParams.get("maxResults")).toBe("25");
    expect(result).toEqual({
      emails: [
        expect.objectContaining({
          uid: "gmail-gmail-work-msg-1",
          account_id: "gmail-work",
          account_label: "Work",
          account_email: "work@example.com",
          from: "Sender <sender@example.com>",
          subject: "Range message",
          body_preview: "Short preview [amounts: $12.34]",
          body_text: "Full body $12.34",
          date: "Fri, 01 May 2026 10:00:00 -0700",
          read: false,
          message_id: "<msg-1@example.com>",
          thread_id: "t-abc123",
        }),
      ],
      nextPageToken: "next-page",
      resultSizeEstimate: 2,
    });
  });
});
