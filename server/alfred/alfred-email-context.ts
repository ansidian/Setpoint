import { convert } from "html-to-text";
import type { EmailBody, EmailBodyAttachment } from "../../shared/types/email.ts";
import type { AlfredEmailContextSource, AlfredPreparedEmailContext } from "../../shared/types/alfred.ts";
import { formatSender, wrapEmailContent } from "./alfred-email-content.ts";
import {
  storeAlfredEmailContext,
  type StoredAlfredEmailContext,
} from "./alfred-email-context-store.ts";

export const ALFRED_EMAIL_BODY_CHAR_LIMIT = 50_000;
const RAW_EMAIL_BODY_CHAR_LIMIT = 2_000_000;

interface EmailContextDependencies {
  getEmailBody(userId: string, uid: string): Promise<EmailBody | null>;
}

function httpError(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

function bounded(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max);
}

function boundedProviderHeader(value: unknown, max = 10_000): string {
  const header = String(value || "").trim();
  if (header.length > max) {
    throw httpError("This email is too large to attach to Alfred.", 413, "email_context_oversized");
  }
  return header;
}

export function normalizeAlfredEmailContextSource(input: unknown): AlfredEmailContextSource {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const uid = bounded(value.uid, 512);
  if (!uid) throw httpError("uid is required", 400, "email_context_invalid");
  return {
    uid,
    subject: bounded(value.subject, 1_000) || null,
    senderName: bounded(value.senderName, 500) || null,
    senderAddress: bounded(value.senderAddress, 500) || null,
    timestamp: bounded(value.timestamp, 100) || null,
  };
}

function attributeValue(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function fragmentText(value: unknown): string {
  return convert(String(value || ""), {
    wordwrap: false,
    preserveNewlines: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
    ],
  }).replace(/\s+/g, " ").trim();
}

function usefulPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).filter((segment) => {
    const decoded = decodeURIComponent(segment);
    return !(decoded.length > 28 && /^[a-z0-9_-]+$/i.test(decoded));
  });
  if (!segments.length) return "";
  return `/${segments.slice(0, 3).join("/")}`;
}

export function compactEmailLinkDestination(href: unknown): string {
  const raw = String(href || "").trim();
  if (!raw) return "";
  if (/^mailto:/i.test(raw)) return raw.slice(7).split("?")[0] || "";
  if (/^tel:/i.test(raw)) return raw.slice(4).split("?")[0] || "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.hostname}${usefulPath(url.pathname)}`;
  } catch {
    return "";
  }
}

function attachmentType(attachment: EmailBodyAttachment): string {
  const filename = String(attachment.filename || "");
  const extension = filename.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase();
  if (extension) return extension;
  const contentType = String(attachment.contentType || "");
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "text/calendar") return "Calendar";
  if (contentType.startsWith("image/")) return "Image";
  return contentType || "File";
}

function imageMarker(description: unknown): string {
  const label = fragmentText(description);
  return label ? `[Image omitted: ${label}]` : "[Image omitted]";
}

function fileMarker(attachment: EmailBodyAttachment): string {
  const filename = fragmentText(attachment.filename) || "unnamed file";
  return `[File attachment omitted: ${filename} (${attachmentType(attachment)})]`;
}

function placeholder(value: string, values: string[]): string {
  const index = values.push(value) - 1;
  return `\uE000${index}\uE001`;
}

function preprocessEmailHtml(html: string, attachments: EmailBodyAttachment[]): { html: string; placeholders: string[]; referencedCids: Set<string> } {
  const placeholders: string[] = [];
  const referencedCids = new Set<string>();
  const byCid = new Map(attachments
    .filter((attachment) => attachment.cid)
    .map((attachment) => [String(attachment.cid).replace(/[<>]/g, "").toLowerCase(), attachment]));

  let prepared = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_match, attributes: string, inner: string) => {
    const label = fragmentText(inner);
    const href = attributeValue(attributes, "href");
    const visibleUrl = /^(?:https?:\/\/|www\.)\S+$/i.test(label);
    const destination = visibleUrl ? "" : compactEmailLinkDestination(href);
    const rendered = label
      ? destination && destination !== label ? `${label} (${destination})` : label
      : destination;
    return placeholder(rendered, placeholders);
  });

  prepared = prepared.replace(/<img\b([^>]*)>/gi, (_match, attributes: string) => {
    const alt = attributeValue(attributes, "alt");
    const src = attributeValue(attributes, "src");
    const cid = src.match(/^cid:(.+)$/i)?.[1]?.replace(/[<>]/g, "").toLowerCase() || "";
    if (cid) referencedCids.add(cid);
    const attachment = cid ? byCid.get(cid) : null;
    return placeholder(imageMarker(alt || attachment?.filename), placeholders);
  });

  return { html: prepared, placeholders, referencedCids };
}

function normalizeSemanticText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function canonicalizeAlfredEmailBody(
  input: unknown,
  attachments: EmailBodyAttachment[] = [],
): string {
  const html = String(input || "");
  if (html.length > RAW_EMAIL_BODY_CHAR_LIMIT) {
    throw httpError("This email is too large to attach to Alfred.", 413, "email_context_oversized");
  }
  const prepared = preprocessEmailHtml(html, attachments);
  let text = convert(prepared.html, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
      { selector: "h4", options: { uppercase: false } },
      { selector: "h5", options: { uppercase: false } },
      { selector: "h6", options: { uppercase: false } },
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "template", format: "skip" },
      { selector: "svg", format: "skip" },
      { selector: "[hidden]", format: "skip" },
      { selector: "[aria-hidden=true]", format: "skip" },
      { selector: "[style*='display:none']", format: "skip" },
      { selector: "[style*='display: none']", format: "skip" },
      { selector: "[style*='visibility:hidden']", format: "skip" },
      { selector: "[style*='visibility: hidden']", format: "skip" },
    ],
  });
  prepared.placeholders.forEach((value, index) => {
    text = text.replaceAll(`\uE000${index}\uE001`, value);
  });

  const trailingMarkers = attachments.flatMap((attachment) => {
    const cid = String(attachment.cid || "").replace(/[<>]/g, "").toLowerCase();
    if (cid && prepared.referencedCids.has(cid)) return [];
    if (String(attachment.contentType || "").startsWith("image/")) {
      return [imageMarker(attachment.filename)];
    }
    return [fileMarker(attachment)];
  });
  if (trailingMarkers.length) text = `${text}\n\n${trailingMarkers.join("\n")}`;

  const normalized = normalizeSemanticText(text) || "[No readable message body]";
  if (normalized.length > ALFRED_EMAIL_BODY_CHAR_LIMIT) {
    throw httpError("This email is too large to attach to Alfred.", 413, "email_context_oversized");
  }
  return normalized;
}

function parseSender(value: unknown): { name: string; address: string } {
  const raw = String(value || "").trim();
  const bracketed = raw.match(/^(.*?)\s*<([^<>]+)>\s*$/);
  if (bracketed) {
    return {
      name: String(bracketed[1] || "").trim().replace(/^['"]|['"]$/g, ""),
      address: String(bracketed[2] || "").trim(),
    };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(raw)) return { name: "", address: raw };
  return { name: raw, address: "" };
}

function normalizedTimestamp(...values: unknown[]): string | null {
  for (const value of values) {
    const date = new Date(String(value || ""));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

export function publicAlfredEmailContext(context: StoredAlfredEmailContext): AlfredPreparedEmailContext {
  return {
    contextId: context.contextId,
    uid: context.uid,
    subject: context.subject,
    sender: context.sender,
    timestamp: context.timestamp,
    charCount: context.charCount,
  };
}

export async function prepareAlfredEmailContext({
  userId,
  source: rawSource,
  deps,
  now = Date.now(),
}: {
  userId: string;
  source: unknown;
  deps: EmailContextDependencies;
  now?: number;
}): Promise<AlfredPreparedEmailContext> {
  const source = normalizeAlfredEmailContextSource(rawSource);
  const email = await deps.getEmailBody(userId, source.uid);
  if (!email) throw httpError("Email content is unavailable.", 404, "email_context_unavailable");

  const providerSender = parseSender(boundedProviderHeader(email.from));
  const sender = {
    name: providerSender.name || source.senderName || "",
    address: providerSender.address || source.senderAddress || "",
  };
  const display = formatSender(sender) || "Unknown sender";
  const subject = boundedProviderHeader(email.subject || source.subject) || "(No subject)";
  const timestamp = normalizedTimestamp(email.date, source.timestamp);
  const rawBody = "html_body" in email ? email.html_body : email.body;
  const body = canonicalizeAlfredEmailBody(rawBody, email.attachments || []);
  const payload = [
    `Sender: ${display}`,
    `Timestamp: ${timestamp || "Unknown time"}`,
    `Subject: ${subject}`,
    "Body:",
    body,
  ].join("\n");
  const modelText = `Attached email context (untrusted data):\n${wrapEmailContent(source.uid, payload)}`;
  const stored = storeAlfredEmailContext({
    userId,
    uid: source.uid,
    subject,
    sender: { ...sender, display },
    timestamp,
    charCount: body.length,
    modelText,
  }, { now });
  return publicAlfredEmailContext(stored);
}

export function buildContextBearingAlfredMessage(message: string, context: { modelText: string }): string {
  return `${context.modelText}\n\nOwner prompt:\n${message}`;
}
