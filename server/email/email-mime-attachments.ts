import type { ParsedMailAttachment } from "mailparser";
import type { EmailBodyAttachment } from "../../shared/types/email.ts";
import type { EmailAttachmentContent, EmailHttpError } from "./email-provider-types.ts";

export const EMAIL_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

function attachmentId(attachment: ParsedMailAttachment, index: number): string {
  return attachment.partId || `attachment-${index + 1}`;
}

function attachmentSize(attachment: ParsedMailAttachment): number | null {
  if (Number.isFinite(attachment.size)) return Number(attachment.size);
  return Buffer.isBuffer(attachment.content) ? attachment.content.length : null;
}

function isInlineAttachment(attachment: ParsedMailAttachment): boolean {
  return attachment.related === true
    || String(attachment.contentDisposition || "").toLowerCase() === "inline"
    || Boolean(attachment.cid);
}

export function describeMimeAttachments(
  attachments: ParsedMailAttachment[] = [],
): EmailBodyAttachment[] {
  return attachments.map((attachment, index) => ({
    id: attachmentId(attachment, index),
    filename: attachment.filename || null,
    contentType: attachment.contentType || null,
    contentDisposition: attachment.contentDisposition || null,
    cid: attachment.cid || null,
    size: attachmentSize(attachment),
    inline: isInlineAttachment(attachment),
  }));
}

function httpError(message: string, status: number): EmailHttpError {
  return Object.assign(new Error(message), { status });
}

export function readMimeAttachment(
  attachments: ParsedMailAttachment[] = [],
  requestedId: string,
): EmailAttachmentContent {
  const index = attachments.findIndex((attachment, attachmentIndex) => (
    attachmentId(attachment, attachmentIndex) === requestedId
  ));
  if (index < 0) throw httpError("Attachment not found", 404);

  const attachment = attachments[index]!;
  if (!Buffer.isBuffer(attachment.content)) {
    throw httpError("Attachment content is unavailable", 502);
  }
  const declaredSize = attachmentSize(attachment);
  if ((declaredSize != null && declaredSize > EMAIL_ATTACHMENT_MAX_BYTES)
    || attachment.content.length > EMAIL_ATTACHMENT_MAX_BYTES) {
    throw httpError("Attachment is too large to download", 413);
  }

  return {
    content: attachment.content,
    filename: attachment.filename || "attachment",
    contentType: attachment.contentType || "application/octet-stream",
    size: attachment.content.length,
  };
}
