import type {
  ParsedTransactionCandidate,
  TransactionEmailInput,
  TransactionParseResult,
} from "../transaction-import-types.ts";
import {
  MAX_NOTES_CHARS,
  cleanText,
  commonWarnings,
  decimalAmountToCents,
  detectCurrency,
  evidence,
  normalizedBody,
  parseIsoDate,
} from "./parser-utils.ts";

export const AMAZON_PARSER_VERSION = "amazon-v1";
export const AMAZON_SENDERS = [
  "auto-confirm@amazon.com",
  "digital-no-reply@amazon.com",
  "order-update@amazon.com",
] as const;

const SUBJECT_PATTERNS = [
  /your amazon\.com order/i,
  /your order #?\d{3}-\d{7}-\d{7}/i,
  /order confirmation/i,
  /your digital order/i,
  /^ordered:/i,
];
const ORDER_NUMBER_PATTERN = /\d{3}-\d{7}-\d{7}/g;

export function matchesAmazonFamily(email: TransactionEmailInput): boolean {
  return SUBJECT_PATTERNS.some((pattern) => pattern.test(email.subject));
}

function orderNumbers(text: string): string[] {
  const cleaned = text.replace(/[\u200E\u200F\u202A-\u202E]/g, "");
  return [...new Set(cleaned.match(ORDER_NUMBER_PATTERN) || [])];
}

function totalCents(text: string): number | null {
  const decimal = text.match(/(?:order\s*total|grand\s*total|total\s*for\s*this\s*order)[:\s]*\$?\s*([\d,]+\.\d{2})/i);
  if (decimal?.[1]) return decimalAmountToCents(decimal[1]);
  const centsOnly = text.match(/(?:order\s*total|grand\s*total|total\s*for\s*this\s*order)[:\s]*\$(\d+)\b/i);
  return centsOnly?.[1] ? Number(centsOnly[1]) || null : null;
}

function itemNames(text: string): string[] {
  const names: string[] = [];
  const linePattern = /^\s*\d+\s+(.+?)\s+\$[\d,]+(?:\.\d{2})?\s*$/gm;
  for (const match of text.matchAll(linePattern)) {
    const name = cleanText(match[1] || "", 150);
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, 10);
}

function buildCandidate(
  email: TransactionEmailInput,
  section: string,
  externalId: string | null,
  date: string,
  usedPlainFallback: boolean,
): ParsedTransactionCandidate | null {
  const cents = totalCents(section);
  if (!cents) return null;
  const currency = detectCurrency(section);
  const items = itemNames(section);
  const notes = cleanText(items.slice(0, 5).join("; "), MAX_NOTES_CHARS);
  return {
    source: "amazon",
    parserVersion: AMAZON_PARSER_VERSION,
    externalId,
    importedId: externalId ? `amazon-${externalId}` : null,
    gmailAccountId: email.gmailAccountId,
    gmailMessageId: email.gmailMessageId,
    emailUid: email.uid,
    internetMessageId: email.internetMessageId || null,
    date,
    amountCents: -cents,
    currency,
    payee: "Amazon",
    notes,
    senderAuthentication: email.senderAuthentication,
    warnings: commonWarnings(email, AMAZON_SENDERS, externalId, currency, usedPlainFallback),
    evidence: [
      evidence("sender", email.from),
      evidence("subject", email.subject),
      evidence("amount", `${currency} ${(cents / 100).toFixed(2)}`),
      ...(email.senderAuthentication ? [{ code: "sender_authentication" as const, value: email.senderAuthentication }] : []),
      ...(externalId ? [evidence("external_id", externalId)] : []),
      ...items.slice(0, 3).map((item) => evidence("item", item)),
    ],
  };
}

export function parseAmazonEmail(email: TransactionEmailInput): TransactionParseResult {
  if (!matchesAmazonFamily(email)) return { kind: "unmatched" };
  const date = parseIsoDate(email.date);
  if (!date) return { kind: "rejected", source: "amazon", reasons: ["invalid_date"] };
  const body = normalizedBody(email);
  if (!body.text) return { kind: "rejected", source: "amazon", reasons: ["missing_body"] };

  const ids = orderNumbers(body.text);
  if (ids.length <= 1) {
    const candidate = buildCandidate(email, body.text, ids[0] || null, date, body.usedPlainFallback);
    return candidate
      ? { kind: "matched", source: "amazon", candidates: [candidate] }
      : { kind: "rejected", source: "amazon", reasons: ["invalid_amount"] };
  }

  const candidates: ParsedTransactionCandidate[] = [];
  for (const [index, id] of ids.entries()) {
    const start = body.text.indexOf(id);
    const nextId = ids[index + 1];
    const end = nextId ? body.text.indexOf(nextId, start + id.length) : body.text.length;
    const section = body.text.slice(start, end < 0 ? body.text.length : end);
    const candidate = buildCandidate(email, section, id, date, body.usedPlainFallback);
    if (!candidate) return { kind: "rejected", source: "amazon", reasons: ["ambiguous_multi_order"] };
    candidates.push(candidate);
  }
  return { kind: "matched", source: "amazon", candidates };
}
