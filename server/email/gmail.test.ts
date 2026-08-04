import { describe, it, expect, vi, beforeEach } from "vitest";

// mock encryption before module load so getValidToken doesn't need real credentials
// test-architecture: allow-boundary-mock -- Gmail token decryption is the cryptographic boundary; HTTP adapter cases use one controlled valid token.
vi.mock("../platform/encryption.ts", () => ({
  decrypt: () => JSON.stringify({
    access_token: "tok",
    refresh_token: "rtok",
    expires_at: Date.now() + 3600_000,
  }),
  encrypt: (s: string) => s,
}));
// test-architecture: allow-boundary-mock -- Google application credentials are a write-only secret boundary used only by provider-token refresh paths.
vi.mock("../google-oauth-credentials.ts", () => ({
  googleOAuthCredentialManager: {
    resolveActive: vi.fn(async () => ({ clientId: "client-id", clientSecret: "client-secret" })),
  },
}));

// We need to stub global fetch before importing the module
vi.stubGlobal("fetch", vi.fn());
const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

const { chunkArray, fetchMessages, fetchEmailsInRange } = await import("./gmail.ts");

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
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg", payload: {} }),
      });

      const ids = Array.from({ length: 25 }, (_, i) => `id${i}`);
      const results = await fetchMessages("token", ids);

      // test-architecture: allow-boundary-interaction -- Gmail message HTTP is outbound; each requested identity must be fetched exactly once with no omissions or duplicates.
      expect(fetchMock).toHaveBeenCalledTimes(25);
      expect(results.length).toBe(25);
    });

    it("does not cap input — fetches all 120 IDs", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg", payload: {} }),
      });

      const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
      const results = await fetchMessages("token", ids);

      // test-architecture: allow-boundary-interaction -- Gmail message HTTP is outbound; bounded concurrency must still fetch each of 120 requested identities exactly once.
      expect(fetchMock).toHaveBeenCalledTimes(120);
      expect(results.length).toBe(120);
    });

    it("logs a warning for each dropped fetch and returns only successes", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      fetchMock
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
      // test-architecture: allow-boundary-interaction -- Retry warnings are the process logging boundary; every exhausted Gmail message request must emit one operational warning.
      expect(warnSpy).toHaveBeenCalledTimes(3);
      warnSpy.mockRestore();
    });

    it("concatenates results from all chunks in order", async () => {
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        const idx = callCount++;
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: `msg${idx}`, payload: {} }),
        });
      });

      const ids = Array.from({ length: 12 }, (_, i) => `id${i}`);
      const results = await fetchMessages("token", ids);

      expect(results.length).toBe(12);
      expect(results[0]!.id).toBe("msg0");
      expect(results[11]!.id).toBe("msg11");
    });
  });
});

describe("fetchEmailsInRange", () => {
  const fakeAccount = {
    id: "gmail-work",
    type: "gmail" as const,
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
    fetchMock
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

    // test-architecture: allow-boundary-interaction -- Gmail list fetch is an outbound provider boundary; query encoding is the provider protocol contract.
    const listUrl = new URL(fetchMock.mock.calls[0]![0]);
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
