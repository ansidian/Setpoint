import type {
  TransactionEmailInput,
  TransactionEvidence,
  TransactionParserWarning,
} from "../transaction-import-types.ts";

export const MAX_BODY_CHARS = 200_000;
export const MAX_NOTES_CHARS = 500;
export const MAX_PAYEE_CHARS = 120;

const CURRENCY_CODES = ["USD", "CAD", "GBP", "EUR"] as const;

export function normalizedMailbox(from: string): string {
  const angleMatch = from.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  return (angleMatch?.[1] || from).trim().toLowerCase();
}

export function hasTrustedSender(from: string, allowlist: readonly string[]): boolean {
  const mailbox = normalizedMailbox(from);
  return allowlist.some((allowed) => mailbox === allowed);
}

export function normalizedBody(email: TransactionEmailInput): { text: string; usedPlainFallback: boolean } {
  const htmlText = email.html ? email.html.slice(0, MAX_BODY_CHARS)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim() : "";
  if (htmlText) return { text: htmlText, usedPlainFallback: false };
  return { text: String(email.text || "").slice(0, MAX_BODY_CHARS), usedPlainFallback: true };
}

export function parseIsoDate(value: string): string | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function decimalAmountToCents(value: string): number | null {
  const normalized = value.replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function detectCurrency(text: string): string {
  for (const code of CURRENCY_CODES) {
    if (new RegExp(`\\b${code}\\b`, "i").test(text)) return code;
  }
  return "USD";
}

export function cleanText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function commonWarnings(
  email: TransactionEmailInput,
  trustedSenders: readonly string[],
  externalId: string | null,
  currency: string,
  usedPlainFallback: boolean,
): TransactionParserWarning[] {
  const warnings: TransactionParserWarning[] = [];
  if (!hasTrustedSender(email.from, trustedSenders)) {
    warnings.push({ code: "untrusted_sender", blocking: true, detail: "Sender mailbox is not trusted for automatic import" });
  }
  if (!externalId) {
    warnings.push({ code: "missing_external_id", blocking: true, detail: "A stable provider transaction identity was not found" });
  }
  if (currency !== "USD") {
    warnings.push({ code: "unsupported_currency", blocking: true, detail: `${currency} requires manual review` });
  }
  if (usedPlainFallback) {
    warnings.push({ code: "plain_text_fallback", blocking: false, detail: "Parsed from plain text because HTML was unavailable" });
  }
  return warnings;
}

export function evidence(code: TransactionEvidence["code"], value: string): TransactionEvidence {
  return { code, value: cleanText(value, 160) };
}
