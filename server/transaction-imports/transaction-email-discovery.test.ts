import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPage = vi.fn();
import { scanTransactionEmails, searchTransactionEmails } from "./transaction-email-discovery.ts";

const account = {
  id: "gmail-personal",
  type: "gmail" as const,
  label: "Personal",
  email: "owner@example.com",
  color: "#123456",
  credentials_encrypted: "stub",
};

function providerEmail(id: string) {
  return {
    gmailMessageId: id,
    threadId: null,
    from: "Amazon <auto-confirm@amazon.com>",
    subject: "Order confirmation",
    date: "2026-07-21T10:00:00Z",
    internetMessageId: `<${id}@example.test>`,
    html: null,
    text: "Order Total: $5.00",
  };
}

describe("transaction email discovery", () => {
  beforeEach(() => fetchPage.mockReset());

  it("traverses more than 50 results across pages without duplicates or omissions", async () => {
    fetchPage
      .mockResolvedValueOnce({
        emails: Array.from({ length: 50 }, (_, index) => providerEmail(`msg-${index}`)),
        nextPageToken: "page-2",
        resultSizeEstimate: 75,
        failures: [],
      })
      .mockResolvedValueOnce({
        emails: Array.from({ length: 26 }, (_, index) => providerEmail(`msg-${index + 49}`)),
        nextPageToken: null,
        resultSizeEstimate: 75,
        failures: [],
      });

    const result = await scanTransactionEmails(account, {
      source: "amazon", start: "2026-07-01", end: "2026-08-01", pageSize: 50,
    }, { fetchPage });
    expect(result.pages).toBe(2);
    expect(result.emails).toHaveLength(75);
    expect(new Set(result.emails.map((email) => email.gmailMessageId)).size).toBe(75);
    // test-architecture: allow-boundary-interaction -- Email page fetching is an outbound provider boundary; continuation tokens are the pagination protocol contract.
    expect(fetchPage.mock.calls[1]![1]).toMatchObject({ pageToken: "page-2" });
  });

  it("preserves raw Gmail IDs through normalization", async () => {
    fetchPage.mockResolvedValueOnce({ emails: [providerEmail("raw-123")], nextPageToken: null, resultSizeEstimate: 1, failures: [] });
    const page = await searchTransactionEmails(account, {
      source: "paypal", start: "2026-07-01", end: "2026-08-01",
    }, { fetchPage });
    expect(page.emails[0]).toMatchObject({
      uid: "gmail-gmail-personal-raw-123",
      gmailAccountId: "gmail-personal",
      gmailMessageId: "raw-123",
      internetMessageId: "<raw-123@example.test>",
    });
  });

  it.each([
    [{ source: "amazon", start: "bad", end: "2026-08-01" }, "valid increasing date range"],
    [{ source: "amazon", start: "2026-08-01", end: "2026-07-01" }, "valid increasing date range"],
    [{ source: "amazon", start: "2025-01-01", end: "2026-08-01" }, "exceeds 366 days"],
    [{ source: "amazon", start: "2026-07-01", end: "2026-08-01", pageSize: 101 }, "page size"],
  ])("validates bounded provider options", async (options, message) => {
    await expect(searchTransactionEmails(account, options as never, { fetchPage })).rejects.toThrow(message);
    // test-architecture: allow-boundary-interaction -- Gmail search is the outbound provider boundary; invalid bounded options must fail before any provider request is issued.
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("rejects repeated page tokens instead of looping", async () => {
    fetchPage.mockResolvedValue({ emails: [], nextPageToken: "same", resultSizeEstimate: 0, failures: [] });
    await expect(scanTransactionEmails(account, {
      source: "amazon", start: "2026-07-01", end: "2026-08-01",
    }, { fetchPage })).rejects.toThrow("repeated a page token");
  });
});
