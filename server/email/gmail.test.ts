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

const {
  fetchMessages,
  fetchEmailsInRange,
  fetchEmailBody,
  fetchEmailAttachment,
} = await import("./gmail.ts");

const ATTACHMENT_SOURCE = Buffer.from([
  "From: Sender <sender@example.com>",
  "Subject: Attachment message",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="ATTACHMENT-BOUNDARY"',
  "",
  "--ATTACHMENT-BOUNDARY",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "See the report.",
  "--ATTACHMENT-BOUNDARY",
  'Content-Type: application/pdf; name="quarterly-report.pdf"',
  'Content-Disposition: attachment; filename="quarterly-report.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-setpoint-test").toString("base64"),
  "--ATTACHMENT-BOUNDARY",
  'Content-Type: image/png; name="signature.png"',
  'Content-Disposition: inline; filename="signature.png"',
  "Content-ID: <signature-logo>",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("png-test").toString("base64"),
  "--ATTACHMENT-BOUNDARY--",
].join("\r\n"));

describe("gmail", () => {
  describe("fetchMessages", () => {
    beforeEach(() => {
      vi.resetAllMocks();
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

  });
});

describe("Gmail reader attachments", () => {
  const fakeAccount = {
    id: "gmail-work",
    type: "gmail" as const,
    label: "Work",
    email: "work@example.com",
    color: "#123456",
    credentials_encrypted: "stub",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ raw: ATTACHMENT_SOURCE.toString("base64url") }),
    });
  });

  it("returns file descriptors while marking related CID parts inline", async () => {
    const body = await fetchEmailBody(fakeAccount, "gmail-gmail-work-message-1");

    expect(body.attachments).toEqual([
      expect.objectContaining({
        id: "2",
        filename: "quarterly-report.pdf",
        contentType: "application/pdf",
        size: Buffer.byteLength("%PDF-setpoint-test"),
        inline: false,
      }),
      expect.objectContaining({
        id: "3",
        filename: "signature.png",
        cid: "signature-logo",
        inline: true,
      }),
    ]);
  });

  it("retrieves the exact MIME part and rejects an unknown part", async () => {
    const attachment = await fetchEmailAttachment(
      fakeAccount,
      "gmail-gmail-work-message-1",
      "2",
    );

    expect(attachment).toMatchObject({
      filename: "quarterly-report.pdf",
      contentType: "application/pdf",
      size: Buffer.byteLength("%PDF-setpoint-test"),
    });
    expect(attachment.content.toString()).toBe("%PDF-setpoint-test");

    await expect(fetchEmailAttachment(
      fakeAccount,
      "gmail-gmail-work-message-1",
      "99",
    )).rejects.toMatchObject({ status: 404 });
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
              {
                name: "Authentication-Results",
                value: "mx.google.com; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=bounce@example.com; dmarc=pass header.from=example.com",
              },
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
          sender_authentication: expect.objectContaining({
            version: 1,
            status: "pass",
            provider: "gmail",
            headerFromDomain: "example.com",
          }),
        }),
      ],
      nextPageToken: "next-page",
      resultSizeEstimate: 2,
    });
  });
});
