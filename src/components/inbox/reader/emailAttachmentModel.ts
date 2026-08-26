import type { EmailBodyAttachment } from "../../../../shared/types/email";

export type EmailAttachmentPreviewKind = "image" | "pdf";

const RASTER_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function visibleEmailAttachments(
  attachments: EmailBodyAttachment[] | null | undefined,
): EmailBodyAttachment[] {
  return (attachments || []).filter((attachment) => !attachment.inline);
}

export function emailAttachmentName(attachment: EmailBodyAttachment): string {
  return String(attachment.filename || "Untitled attachment").trim() || "Untitled attachment";
}

export function emailAttachmentPreviewKind(
  contentType: string | null | undefined,
): EmailAttachmentPreviewKind | null {
  const normalized = String(contentType || "").split(";", 1)[0]!.trim().toLowerCase();
  if (normalized === "application/pdf") return "pdf";
  if (RASTER_IMAGE_TYPES.has(normalized)) return "image";
  return null;
}

export function formatAttachmentSize(size: number | null | undefined): string {
  if (!Number.isFinite(size) || Number(size) < 0) return "Unknown size";
  const bytes = Number(size);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function emailAttachmentTypeLabel(attachment: EmailBodyAttachment): string {
  const filename = emailAttachmentName(attachment);
  const extension = filename.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (extension) return extension.toUpperCase();
  const contentType = String(attachment.contentType || "");
  if (contentType === "application/pdf") return "PDF";
  if (contentType.startsWith("image/")) return "Image";
  return contentType.split("/", 2)[1]?.toUpperCase() || "File";
}
