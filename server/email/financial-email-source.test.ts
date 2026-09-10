import { createHash } from "node:crypto";
import type { Client, InStatement } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailIndexTestDb, seedEmailAccount, seedIndexedEmail } from "./test-utils/email-index-db.ts";
import { encrypt } from "../platform/encryption.ts";
import { accountCredentialContext } from "../platform/credential-encryption-context.ts";
import { FINANCIAL_EMAIL_SOURCE_LIMITS as limits } from "./financial-email-source.ts";
import type { ConfiguredEmailAccount } from "./email-provider-types.ts";

const boundary = vi.hoisted(() => ({
  db: null as Client | null,
  imap: { raw: Buffer.from("") as Buffer, size: undefined as number | undefined, missing: false, stalled: false, seen: false, locks: 0, receivingAccount: "" },
}));

// test-architecture: allow-boundary-mock -- The application DB singleton is redirected to an ephemeral libSQL database; account routing and unchanged index state run through real SQL.
vi.mock("../db/connection.ts", () => ({ default: {
  execute: (statement: string | InStatement) => {
    if (!boundary.db) throw new Error("No test database");
    return boundary.db.execute(statement);
  },
} }));

vi.mock("imapflow", () => ({ ImapFlow: class {
  usable = true;
  constructor(options: { auth: { user: string } }) { boundary.imap.receivingAccount = options.auth.user; }
  async connect() {}
  on() {}
  close() { this.usable = false; }
  async logout() { this.usable = false; }
  async getMailboxLock(mailbox: string) {
    if (mailbox !== "INBOX") throw new Error("Wrong mailbox");
    boundary.imap.locks++;
    return { release: () => { boundary.imap.locks--; } };
  }
  async fetchOne(uid: string, query: { source: { start: number; maxLength: number }; size: boolean }, options: { uid: boolean }) {
    if (query.source?.start !== 0 || query.source.maxLength !== 8 * 1024 * 1024 + 1 || !query.size || !options.uid) {
      throw new Error("Financial source acquisition must request bounded BODY.PEEK bytes and RFC822.SIZE by UID");
    }
    if (boundary.imap.missing) return false;
    if (boundary.imap.stalled) return new Promise<never>(() => {});
    return {
      uid: Number(uid),
      source: boundary.imap.raw.subarray(0, query.source.maxLength),
      size: boundary.imap.size ?? boundary.imap.raw.length,
      internalDate: new Date("2026-09-08T18:45:12.000Z"),
    };
  }
  async messageFlagsAdd() { boundary.imap.seen = true; }
} }));

const { fetchFinancialEmailSourceForUid } = await import("./email-provider-adapters.ts");
const { fetchFinancialEmailSource: fetchGmailFinancialSource } = await import("./gmail.ts");
const { fetchFinancialEmailSource: fetchIcloudFinancialSource } = await import("./icloud.ts");

interface PdfCell { x: number; y: number; text: string }

/** Sanitized, valid PDF bytes with a real cross-reference table and positioned text. */
function invoicePdf(pages: PdfCell[][] = [[
  { x: 300, y: 710, text: "$124.80" }, { x: 50, y: 710, text: "Amount due" },
  { x: 300, y: 690, text: "09/24/2026" }, { x: 50, y: 690, text: "Due date" },
]], { encrypted = false, rasterInvoice = false } = {}): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, cells] of pages.entries()) {
    const stream = cells.map(({ x, y, text }) => `BT /F1 12 Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`).join("\n")
      + (rasterInvoice ? "\nq 500 0 0 650 50 50 cm /Im1 Do Q" : "");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >>${rasterInvoice ? ` /XObject << /Im1 ${4 + pages.length * 2} 0 R >>` : ""} >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  if (rasterInvoice) objects.push("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\nx\nendstream");
  if (encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"0".repeat(64)}> /U <${"0".repeat(64)}> /P -4 >>`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<0011223344556677><0011223344556677>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const gmailAuthentication = ["Authentication-Results: mx.google.com; dkim=pass header.i=@billing.example; dmarc=pass header.from=billing.example"];
const icloudAuthentication = [
  "Received: from p01-icloudmta-smtpin-example by p01-mailgateway-smtp-example (mailgateway)",
  "Received: from smtp.billing.example by p01-icloudmta-smtpin-example (Postfix)",
  "X-ICL-Repid: redacted", "X-ICL-Info: redacted", "X-ICL-Score: redacted",
  "Authentication-Results: bimi.icloud.com; bimi=none",
  "Authentication-Results: arc.icloud.com; arc=none",
  "Authentication-Results: dmarc.icloud.com; dmarc=pass header.from=billing.example",
  "Authentication-Results: dkim-verifier.icloud.com; dkim=pass header.d=billing.example",
  "Authentication-Results: spf.icloud.com; spf=pass smtp.mailfrom=billing.example",
];

function emailSource({
  text = "Please see your attached invoice.", html = "", auth = gmailAuthentication,
  files = [{ content: invoicePdf(), name: "invoice.pdf", type: "application/pdf" }],
}: { text?: string; html?: string; auth?: string[]; files?: Array<{ content: Buffer; name: string; type: string }> } = {}): Buffer {
  return Buffer.from([
    ...auth,
    "From: Utility Billing <notice@billing.example>",
    "Subject: Your September invoice", "Date: Mon, 7 Sep 2026 08:00:00 -0700",
    "Message-ID: <september-invoice@billing.example>", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="FINANCIAL-MIME"', "",
    "--FINANCIAL-MIME",
    ...(html ? [
      'Content-Type: multipart/alternative; boundary="BODY-ALTERNATIVE"', "",
      "--BODY-ALTERNATIVE", "Content-Type: text/plain; charset=utf-8", "", text,
      "--BODY-ALTERNATIVE", "Content-Type: text/html; charset=utf-8", "", html,
      "--BODY-ALTERNATIVE--",
    ] : ["Content-Type: text/plain; charset=utf-8", "", text]),
    ...files.flatMap((file) => [
      "--FINANCIAL-MIME", `Content-Type: ${file.type}; name="${file.name}"`,
      `Content-Disposition: attachment; filename="${file.name}"`, "Content-Transfer-Encoding: base64", "",
      file.content.toString("base64").match(/.{1,76}/g)?.join("\r\n") || "",
    ]),
    "--FINANCIAL-MIME--", "",
  ].join("\r\n"));
}

let gmailAccount: ConfiguredEmailAccount;
let requestLog: string[];

function serveGmail(raw: Buffer, overrides: Record<string, unknown> = {}): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    requestLog.push(url);
    if (url !== "https://www.googleapis.com/gmail/v1/users/me/messages/message-1?format=raw" || init?.method) throw new Error("Unexpected external message fetch or mutation");
    return Response.json({ id: "message-1", raw: raw.toString("base64url"), threadId: "original-thread", internalDate: "1788893112000", ...overrides });
  });
}

beforeEach(async () => {
  vi.stubEnv("EA_ENCRYPTION_KEY", "d1".repeat(32));
  boundary.db = await createEmailIndexTestDb();
  requestLog = [];
  boundary.imap = { raw: Buffer.from(""), size: undefined, missing: false, stalled: false, seen: false, locks: 0, receivingAccount: "" };
  gmailAccount = {
    id: "gmail-source", type: "gmail", email: "owner@example.com", label: "Personal", color: "#123456",
    credentials_encrypted: encrypt(JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", expires_at: Date.now() + 3_600_000 }), accountCredentialContext("gmail-source")),
  };
  await seedEmailAccount(boundary.db, { ...gmailAccount, user_id: "user-1" });
});

afterEach(async () => {
  await boundary.db?.close();
  boundary.db = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("complete financial email source acquisition", () => {
  it("returns original Gmail body, exact PDF provenance, date and authentication from one request without mutating the index", async () => {
    const pdf = invoicePdf();
    serveGmail(emailSource({ files: [{ content: pdf, name: "invoice.pdf", type: "application/pdf" }] }));
    await seedIndexedEmail(boundary.db!, { uid: "gmail-gmail-source-message-1", account_id: gmailAccount.id, body_text: "Historic incomplete body", read: 0 });
    const original = await boundary.db!.execute("SELECT * FROM ea_email_index");

    const source = await fetchFinancialEmailSourceForUid("user-1", "gmail-gmail-source-message-1");

    expect(source).toMatchObject({
      fromName: "Utility Billing", fromAddress: "notice@billing.example", subject: "Your September invoice",
      emailDate: "2026-09-08T18:45:12.000Z", threadId: "original-thread", messageId: "<september-invoice@billing.example>",
      senderAuthentication: { provider: "gmail", status: "pass", headerFromDomain: "billing.example" },
      attachments: [{ partId: "2", filename: "invoice.pdf", bytes: pdf.length, pages: 1, sha256: createHash("sha256").update(pdf).digest("hex"), extractorVersion: expect.stringMatching(/^pdfjs-[\d.]+:setpoint-text-v1$/) }],
    });
    expect(source.body).toContain("Please see your attached invoice.");
    expect(source.body).toContain("[Attachment provenance only; not bill facts:");
    expect(source.body).toContain("[Page 1 of 1]\nAmount due | $124.80\nDue date | 09/24/2026");
    expect((await boundary.db!.execute("SELECT * FROM ea_email_index")).rows).toEqual(original.rows);
    expect(requestLog).toEqual(["https://www.googleapis.com/gmail/v1/users/me/messages/message-1?format=raw"]);
  });

  it("uses the same HTML-placeholder and table normalization as ingestion, with distinct attachment/page boundaries", async () => {
    const second = invoicePdf([[{ x: 50, y: 710, text: "Current charges $80.00" }], [{ x: 50, y: 710, text: "Prior balance $44.80" }]]);
    serveGmail(emailSource({
      text: "Please view this message using an HTML-enabled application.",
      html: "<table><tr><td>Total</td><td>$124.80</td></tr><tr><td>Due date</td><td>September 24, 2026</td></tr></table>",
      files: [{ content: invoicePdf(), name: "invoice.pdf", type: "application/pdf" }, { content: second, name: "details.pdf", type: "application/pdf" }],
    }));
    const source = await fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1");
    expect(source.body).toMatch(/Total\s+\$124\.80\nDue date\s+September 24, 2026/);
    expect(source.body).not.toContain("HTML-enabled");
    expect(source.body).toContain("[Page 2 of 2]\nPrior balance $44.80");
    expect(source.attachments.map((attachment) => [attachment.partId, attachment.filename, attachment.pages])).toEqual([["2", "invoice.pdf", 1], ["3", "details.pdf", 2]]);
  });

  it("preserves failed sender authentication from the original source", async () => {
    const auth = ["Authentication-Results: mx.google.com; dmarc=fail header.from=billing.example"];
    serveGmail(emailSource({ auth, text: "Amount due $124.80 on September 24, 2026.", files: [] }));
    const source = await fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1");
    expect(source.senderAuthentication?.status).toBe("fail");
    expect(source.attachments).toEqual([]);
  });

  it("uses the displayed scheduled notice without importing a stale plain-text cancellation or inventing an amount", async () => {
    serveGmail(emailSource({
      text: "Your automatic payment has been CANCELLED. Please make another payment arrangement.\nClick this link to view your message online.",
      html: "<p>Your automatic payment is scheduled for September 24, 2026.</p><table><tr><td>Payment amount</td><td>Full statement balance</td></tr></table>",
      files: [],
    }));
    const source = await fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1");
    expect(source.body).not.toContain("CANCELLED");
    expect(source.body).not.toContain("Original MIME");
    expect(source.body).toContain("Your automatic payment is scheduled for September 24, 2026.");
    expect(source.body).toMatch(/Payment amount\s+Full statement balance/);
    expect(source.body).not.toMatch(/\$\d/);
  });

  it("falls back to plain text when the HTML body is empty", async () => {
    serveGmail(emailSource({ text: "Payment amount: $238.80", html: "<html><body> </body></html>", files: [] }));
    expect((await fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).body).toBe("Payment amount: $238.80");
  });

  it("preserves independent plain-text mixed parts alongside the selected HTML alternative", async () => {
    const raw = emailSource({ text: "Stale alternative", html: "<p>Your payment is scheduled.</p>", files: [] }).toString();
    serveGmail(Buffer.from(raw.replace("--FINANCIAL-MIME--", [
      "--FINANCIAL-MIME", "Content-Type: text/plain; charset=utf-8", "",
      "Separate payment reference: ABC123", "--FINANCIAL-MIME--",
    ].join("\r\n"))));
    const source = await fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1");
    expect(source.body).toContain("Your payment is scheduled.");
    expect(source.body).toContain("Separate payment reference: ABC123");
    expect(source.body).not.toContain("Stale alternative");
  });

  it("requires an owner account before fetching an email", async () => {
    serveGmail(emailSource());
    await expect(fetchFinancialEmailSourceForUid("other-owner", "gmail-gmail-source-message-1")).rejects.toMatchObject({ status: 404 });
    expect(requestLog).toEqual([]);
  });

  it("rejects a missing raw Gmail source", async () => {
    serveGmail(emailSource(), { raw: undefined });
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code: "financial_source_unavailable" });
  });

  it("rejects a vanished Gmail source", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code: "financial_source_unavailable", status: 404 });
  });

  it("returns a typed retryable failure for Gmail transport timeouts", async () => {
    vi.stubGlobal("fetch", async () => { throw new DOMException("Test timeout", "TimeoutError"); });
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code: "financial_source_timeout", status: 503 });
  });

  it.each([false, true])("enforces the response byte cap before parsing JSON with declared length=%s", async (declared) => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(limits.gmailResponseBytes + 1), { headers: declared ? { "content-length": String(limits.gmailResponseBytes + 1) } : {} }));
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code: "financial_source_oversized", status: 413 });
  });

  it.each([
    { name: "truncated PDF", content: () => invoicePdf().subarray(0, -8), code: "financial_pdf_incomplete" },
    { name: "corrupt PDF", content: () => Buffer.from("not a PDF"), code: "financial_pdf_corrupt" },
    { name: "encrypted PDF", content: () => invoicePdf(undefined, { encrypted: true }), code: "financial_pdf_encrypted" },
    { name: "textless PDF", content: () => invoicePdf([[]]), code: "financial_pdf_textless" },
    { name: "partially rasterized invoice", content: () => invoicePdf(undefined, { rasterInvoice: true }), code: "financial_pdf_incomplete" },
    { name: "too many pages", content: () => invoicePdf(Array.from({ length: 11 }, () => [{ x: 50, y: 710, text: "Amount due $124.80" }])), code: "financial_pdf_pages" },
    { name: "oversized PDF", content: () => Buffer.alloc(limits.pdfBytes + 1), code: "financial_pdf_oversized" },
  ])("fails closed for $name", async ({ content, code }) => {
    serveGmail(emailSource({ files: [{ content: content(), name: "invoice.pdf", type: "application/pdf" }] }));
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code });
  });

  it("refuses too many PDFs and an unsupported attachment instead of silently dropping evidence", async () => {
    serveGmail(emailSource({ files: Array.from({ length: 4 }, (_, index) => ({ content: invoicePdf(), name: `invoice-${index}.pdf`, type: "application/pdf" })) }));
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code: "financial_pdf_count" });
    serveGmail(emailSource({ files: [{ content: Buffer.from("amount,date\n124.80,2026-09-24"), name: "invoice.csv", type: "text/csv" }] }));
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code: "financial_source_unsupported_attachment" });
  });

  it("rejects incomplete MIME and an over-limit combined body rather than truncating facts", async () => {
    serveGmail(Buffer.from(emailSource().toString().replace("--FINANCIAL-MIME--", "")));
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code: "financial_source_incomplete" });
    serveGmail(emailSource({ text: "Relevant bill detail. ".repeat(900) }));
    await expect(fetchGmailFinancialSource(gmailAccount, "gmail-gmail-source-message-1")).rejects.toMatchObject({ code: "financial_source_oversized" });
  });

  it("fetches and authenticates one complete iCloud source without marking read", async () => {
    boundary.imap.raw = emailSource({ auth: icloudAuthentication });
    const credentials = encrypt("test-password", accountCredentialContext("icloud-source"));
    await seedEmailAccount(boundary.db!, { id: "icloud-source", type: "icloud", email: "source@icloud.test", credentials_encrypted: credentials });
    await seedEmailAccount(boundary.db!, { id: "icloud-other", type: "icloud", email: "other@icloud.test" });
    await seedIndexedEmail(boundary.db!, { uid: "icloud-42", account_id: "icloud-source", account_email: "source@icloud.test", read: 0 });

    const source = await fetchFinancialEmailSourceForUid("user-1", "icloud-42");

    expect(source).toMatchObject({
      emailDate: "2026-09-08T18:45:12.000Z", fromAddress: "notice@billing.example",
      messageId: "<september-invoice@billing.example>", threadId: null,
      senderAuthentication: { provider: "icloud", status: "pass" },
    });
    expect(source.body).toContain("Amount due | $124.80");
    expect(boundary.imap).toMatchObject({ receivingAccount: "source@icloud.test", seen: false, locks: 0 });
    expect((await boundary.db!.execute("SELECT read FROM ea_email_index WHERE uid = 'icloud-42'")).rows[0]?.read).toBe(0);
  });

  it("rejects missing, truncated and oversized iCloud sources with no read-state changes", async () => {
    boundary.imap.missing = true;
    await expect(fetchIcloudFinancialSource("missing@icloud.test", "test", "icloud-42")).rejects.toMatchObject({ code: "financial_source_unavailable" });
    boundary.imap.missing = false;
    boundary.imap.raw = emailSource();
    boundary.imap.size = boundary.imap.raw.length + 1;
    await expect(fetchIcloudFinancialSource("truncated@icloud.test", "test", "icloud-42")).rejects.toMatchObject({ code: "financial_source_incomplete" });
    boundary.imap.size = limits.messageBytes + 100;
    await expect(fetchIcloudFinancialSource("oversized@icloud.test", "test", "icloud-42")).rejects.toMatchObject({ code: "financial_source_oversized" });
    expect(boundary.imap).toMatchObject({ seen: false, locks: 0 });
  });

  it("releases and discards a timed-out iCloud connection so a source retry can succeed", async () => {
    vi.useFakeTimers();
    boundary.imap.stalled = true;
    const failure = expect(fetchIcloudFinancialSource("retry@icloud.test", "test", "icloud-42")).rejects.toMatchObject({ code: "financial_source_timeout", status: 503 });
    await vi.advanceTimersByTimeAsync(limits.fetchTimeoutMs + 1);
    await failure;
    expect(boundary.imap).toMatchObject({ seen: false, locks: 0 });
    vi.useRealTimers();
    boundary.imap.stalled = false;
    boundary.imap.raw = emailSource({ auth: icloudAuthentication, files: [], text: "Amount due $124.80 on September 24, 2026." });
    expect((await fetchIcloudFinancialSource("retry@icloud.test", "test", "icloud-42")).senderAuthentication?.status).toBe("pass");
  });
});
