import { parentPort, workerData } from "node:worker_threads";
import { simpleParser } from "mailparser";
import { describeMimeAttachments } from "./email-mime-attachments.ts";
import { emailEvidenceFromMime, requireCompleteEmailEvidence } from "./email-evidence.ts";
import { normalizeEmailDateUtc } from "./email-date.ts";
import { evaluateGmailSenderAuthentication, evaluateICloudSenderAuthentication } from "./sender-authentication.ts";
import { extractFinancialPdfEvidence } from "./financial-pdf-evidence.ts";
import {
  FINANCIAL_EMAIL_SOURCE_LIMITS as limits, FinancialEmailSourceError,
  type FinancialEmailSource, type FinancialSourceErrorCode, type FinancialSourceMetadata,
} from "./financial-email-source.ts";

export type FinancialSourceWorkerResult =
  | { ok: true; source: FinancialEmailSource }
  | { ok: false; code: FinancialSourceErrorCode; message: string; status: number };

function requireMimeEnvelope(raw: Buffer): void {
  const text = raw.toString("latin1");
  if (!/\r?\n\r?\n/.test(text)) {
    throw new FinancialEmailSourceError("financial_source_incomplete", "The original email has no complete header block.");
  }
  // mailparser tolerates missing multipart terminators; financial evidence must
  // not accept a provider prefix as a complete attachment or body alternative.
  const contentTypes = text.match(/^Content-Type:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/gim) || [];
  for (const contentType of contentTypes) {
    if (!/^Content-Type:\s*multipart\//i.test(contentType)) continue;
    const boundary = contentType.match(/\bboundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i);
    const value = boundary?.[1] || boundary?.[2];
    if (!value || !text.split(/\r?\n/).some((line) => line.trimEnd() === `--${value}--`)) {
      throw new FinancialEmailSourceError("financial_source_incomplete", "The original email contains an incomplete MIME part.");
    }
  }
}

async function buildSource(raw: Buffer, metadata: FinancialSourceMetadata): Promise<FinancialEmailSource> {
  requireMimeEnvelope(raw);
  // Keep mailparser's text-to-HTML projection for independent multipart/mixed
  // sections. It omits plain alternatives from that HTML, matching the reader.
  const parsed = await simpleParser(raw, { skipHtmlToText: true });
  const headers = (parsed.headerLines || []).map(({ key, line }) => ({
    name: key,
    value: line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim(),
  }));
  const claimedFrom = headers.find((header) => header.name.toLowerCase() === "from")?.value || "";
  const fromAddress = parsed.from?.value?.[0]?.address || "";
  const emailDate = normalizeEmailDateUtc(metadata.emailDate) || normalizeEmailDateUtc(parsed.date?.toISOString());
  if (!fromAddress || !emailDate) throw new FinancialEmailSourceError("financial_source_incomplete", "The original email is missing its sender or original timestamp.");
  const bodyText = emailEvidenceFromMime(parsed);
  if (bodyText.length > limits.combinedChars) throw new FinancialEmailSourceError("financial_source_oversized", "Complete email text exceeds the financial decision limit.", 413);
  const attachments = parsed.attachments || [];
  const descriptors = describeMimeAttachments(attachments);
  const pdfs = descriptors.filter((attachment) => attachment.contentType?.toLowerCase() === "application/pdf" || /\.pdf$/i.test(attachment.filename || ""));
  if (pdfs.length > limits.pdfCount) throw new FinancialEmailSourceError("financial_pdf_count", "The email has more PDF attachments than the financial evidence limit.");
  if (descriptors.some((attachment) => !pdfs.includes(attachment) && !attachment.inline)) {
    throw new FinancialEmailSourceError("financial_source_unsupported_attachment", "The email includes an unsupported financial evidence attachment.");
  }
  if (!pdfs.length && (!bodyText || !bodyText.replace(/\[Image omitted[^\]]*\]/g, "").trim())) {
    throw new FinancialEmailSourceError(descriptors.length ? "financial_source_unsupported_attachment" : "financial_source_incomplete", "The email has no complete readable financial evidence.");
  }
  const source: FinancialEmailSource = {
    body: requireCompleteEmailEvidence(bodyText),
    fromName: parsed.from?.value?.[0]?.name || "",
    fromAddress,
    subject: parsed.subject || "",
    emailDate,
    threadId: metadata.threadId || null,
    messageId: parsed.messageId || null,
    senderAuthentication: metadata.provider === "gmail"
      ? evaluateGmailSenderAuthentication(headers, claimedFrom)
      : evaluateICloudSenderAuthentication(headers, fromAddress),
    attachments: [],
  };
  for (const descriptor of pdfs) {
    const content = attachments[descriptors.indexOf(descriptor)]?.content;
    if (!content?.length || descriptor.size !== content.length) throw new FinancialEmailSourceError("financial_pdf_incomplete", "A PDF attachment is missing complete bytes.");
    const pdf = await extractFinancialPdfEvidence(content);
    const attachment = {
      partId: descriptor.id, filename: descriptor.filename || "attachment.pdf",
      sha256: pdf.sha256, bytes: content.length, pages: pdf.pages, extractorVersion: pdf.extractorVersion,
    };
    const boundary = `part=${JSON.stringify(attachment.partId)} filename=${JSON.stringify(attachment.filename)} sha256=${attachment.sha256}`;
    const combined = `${source.body}\n\n[Attachment provenance only; not bill facts: ${boundary}]\n[Begin extracted PDF text]\n${pdf.text}\n[End extracted PDF text]`;
    if (combined.length > limits.combinedChars) throw new FinancialEmailSourceError("financial_source_oversized", "Complete email and PDF evidence exceeds the financial decision limit.", 413);
    source.body = requireCompleteEmailEvidence(combined);
    source.attachments.push(attachment);
  }
  return source;
}

if (parentPort) {
  const input = workerData as { raw: Uint8Array; metadata: FinancialSourceMetadata };
  void buildSource(Buffer.from(input.raw), input.metadata).then(
    (source) => parentPort!.postMessage({ ok: true, source } satisfies FinancialSourceWorkerResult),
    (error: unknown) => {
      const failure = error instanceof FinancialEmailSourceError ? error : new FinancialEmailSourceError(
        "financial_source_incomplete", "The original email could not produce complete financial evidence.",
      );
      parentPort!.postMessage({ ok: false, code: failure.code, message: failure.message, status: failure.status } satisfies FinancialSourceWorkerResult);
    },
  );
}
