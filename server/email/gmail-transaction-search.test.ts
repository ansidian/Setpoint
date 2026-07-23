import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/encryption.ts", () => ({
  decrypt: () => JSON.stringify({
    access_token: "tok",
    refresh_token: "rtok",
    expires_at: Date.now() + 3_600_000,
  }),
  encrypt: (value: string) => value,
}));
vi.mock("../google-oauth-credentials.ts", () => ({
  googleOAuthCredentialManager: {
    resolveActive: vi.fn(async () => ({ clientId: "client-id", clientSecret: "client-secret" })),
  },
}));

vi.stubGlobal("fetch", vi.fn());
const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
const { fetchGmailTransactionEmailPage, GmailTransactionSearchError } = await import("./transaction-email-search.ts");

const account = {
  id: "gmail-personal",
  type: "gmail" as const,
  label: "Personal",
  email: "owner@example.com",
  color: "#123456",
  credentials_encrypted: "stub",
};

function message(id: string) {
  return {
    id,
    threadId: `thread-${id}`,
    payload: {
      headers: [
        { name: "From", value: "Amazon <auto-confirm@amazon.com>" },
        { name: "Subject", value: "Order confirmation" },
        { name: "Date", value: "Tue, 21 Jul 2026 10:30:00 -0700" },
        { name: "Message-ID", value: `<${id}@example.test>` },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("Order Total: $5.00").toString("base64url") } },
        { mimeType: "text/html", body: { data: Buffer.from("<b>Order Total: $5.00</b>").toString("base64url") } },
      ],
    },
  };
}

describe("Gmail transaction search", () => {
  beforeEach(() => vi.resetAllMocks());

  it("builds an allowlisted all-mail source/date query and preserves raw Gmail identity", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: "msg-1" }], nextPageToken: "next", resultSizeEstimate: 2 }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => message("msg-1") });

    const page = await fetchGmailTransactionEmailPage(account, {
      source: "amazon",
      start: "2026-07-01T00:00:00Z",
      end: "2026-08-01T00:00:00Z",
      pageToken: "cursor",
      maxResults: 50,
    });

    const listUrl = new URL(fetchMock.mock.calls[0]![0]);
    expect(listUrl.searchParams.get("q")).toBe(
      "(from:auto-confirm@amazon.com OR from:digital-no-reply@amazon.com OR from:order-update@amazon.com) (subject:order OR subject:ordered) after:2026/06/30 before:2026/08/02",
    );
    expect(listUrl.searchParams.has("labelIds")).toBe(false);
    expect(listUrl.searchParams.get("pageToken")).toBe("cursor");
    expect(listUrl.searchParams.get("maxResults")).toBe("50");
    expect(page).toEqual({
      emails: [{
        gmailMessageId: "msg-1",
        threadId: "thread-msg-1",
        from: "Amazon <auto-confirm@amazon.com>",
        subject: "Order confirmation",
        date: "Tue, 21 Jul 2026 10:30:00 -0700",
        internetMessageId: "<msg-1@example.test>",
        html: "<b>Order Total: $5.00</b>",
        text: "Order Total: $5.00",
      }],
      nextPageToken: "next",
      resultSizeEstimate: 2,
      failures: [],
    });
  });

  it("searches the full selected date range, including both boundary dates", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await fetchGmailTransactionEmailPage(account, {
      source: "amazon",
      start: "2026-06-23",
      end: "2026-07-23",
      maxResults: 50,
    });

    const listUrl = new URL(fetchMock.mock.calls[0]![0]);
    expect(listUrl.searchParams.get("q")).toContain("after:2026/06/22 before:2026/07/24");
  });

  it("deduplicates IDs within a page and supports an empty page", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "msg-1" }, { id: "msg-1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => message("msg-1") });
    const first = await fetchGmailTransactionEmailPage(account, {
      source: "paypal", start: "2026-07-01", end: "2026-08-01", maxResults: 25,
    });
    expect(first.emails).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const empty = await fetchGmailTransactionEmailPage(account, {
      source: "paypal", start: "2026-07-01", end: "2026-08-01", maxResults: 25,
    });
    expect(empty).toEqual({ emails: [], nextPageToken: null, resultSizeEstimate: 0, failures: [] });
  });

  it.each([
    [400, "bad page token", true, "page_token_expired"],
    [401, "unauthorized", false, "reauth_required"],
    [429, "quota exceeded", false, "rate_limited"],
    [503, "unavailable", false, "provider_unavailable"],
  ])("classifies provider status %s", async (status, body, withToken, code) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status, text: async () => body });
    const promise = fetchGmailTransactionEmailPage(account, {
      source: "amazon",
      start: "2026-07-01",
      end: "2026-08-01",
      pageToken: withToken ? "expired" : undefined,
      maxResults: 25,
    });
    await expect(promise).rejects.toMatchObject({ name: GmailTransactionSearchError.name, code, status });
  });

  it("returns explicit partial message failures without dropping successful results", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "ok" }, { id: "bad" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => message("ok") })
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limit" });
    const page = await fetchGmailTransactionEmailPage(account, {
      source: "amazon", start: "2026-07-01", end: "2026-08-01", maxResults: 25,
    });
    expect(page.emails.map((email) => email.gmailMessageId)).toEqual(["ok"]);
    expect(page.failures).toEqual([{ gmailMessageId: "bad", code: "rate_limited", status: 429 }]);
  });
});
