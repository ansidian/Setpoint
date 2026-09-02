import type {
  ParsedTransactionCandidate,
  TransactionEmailInput,
  TransactionParseResult,
} from "../transaction-import-types.ts";
import {
  MAX_NOTES_CHARS,
  MAX_PAYEE_CHARS,
  cleanText,
  commonWarnings,
  decimalAmountToCents,
  detectCurrency,
  evidence,
  normalizedBody,
  parseIsoDate,
} from "./parser-utils.ts";

export const PAYPAL_PARSER_VERSION = "paypal-v1";
export const PAYPAL_SENDERS = ["service@paypal.com", "service@intl.paypal.com"] as const;

const SUBJECT_PATTERNS = [
  /you (?:paid|sent) \$[\d,.]+/i,
  /receipt for your payment/i,
  /you've sent a payment/i,
  /you submitted an order/i,
  /^.+:\s*\$[\d,.]+\s*(?:USD|CAD|GBP|EUR)/i,
];
const TRANSACTION_ID_PATTERN = /transaction\s*id[:\s]*((?:O-)?[A-Z0-9]{17,19})(?![A-Z0-9])/i;

export function matchesPayPalFamily(email: TransactionEmailInput): boolean {
  if (SUBJECT_PATTERNS.some((pattern) => pattern.test(email.subject))) return true;
  return /you (?:paid|sent) \$[\d,.]+/i.test(email.text || "");
}

function extractSubjectFields(subject: string): { amount: string | null; merchant: string | null } {
  const patterns = [
    /you (?:paid|sent) \$?([\d,]+(?:\.\d{1,2})?)\s*(?:USD|CAD|GBP|EUR)?\s*to\s+(.+)/i,
    /you submitted an order in the amount of \$?([\d,]+(?:\.\d{1,2})?)\s*(?:USD|CAD|GBP|EUR)?\s*to\s+(.+)/i,
    /^(.+?):\s*\$?([\d,]+(?:\.\d{1,2})?)\s*(?:USD|CAD|GBP|EUR)/i,
  ];
  const standard = subject.match(patterns[0]!);
  if (standard) return { amount: standard[1] || null, merchant: standard[2] || null };
  const submitted = subject.match(patterns[1]!);
  if (submitted) return { amount: submitted[1] || null, merchant: submitted[2] || null };
  const merchantFirst = subject.match(patterns[2]!);
  if (merchantFirst) return { amount: merchantFirst[2] || null, merchant: merchantFirst[1] || null };
  const receipt = subject.match(/receipt for your payment to\s+(.+)/i);
  return { amount: null, merchant: receipt?.[1] || null };
}

function extractBodyAmount(text: string): string | null {
  return text.match(/(?:total|amount|you (?:paid|sent))[:\s]*\$?([\d,]+\.\d{2})/i)?.[1] ||
    text.match(/you placed a \$?([\d,]+(?:\.\d{1,2})?)\s*(?:USD|CAD|GBP|EUR)?\s*order with/i)?.[1] ||
    null;
}

function extractBodyMerchant(text: string): string | null {
  return text.match(/(?:you (?:paid|sent) \$[\d,.]+\s*(?:USD|CAD|GBP|EUR)?\s*to|payment to)\s+(.+?)(?:\n|$)/im)?.[1] ||
    text.match(/you placed a \$?[\d,]+(?:\.\d{1,2})?\s*(?:USD|CAD|GBP|EUR)?\s*order with\s+(.+?)(?:\s*\(|\n|$)/i)?.[1] ||
    null;
}

export function parsePayPalEmail(email: TransactionEmailInput): TransactionParseResult {
  if (!matchesPayPalFamily(email)) return { kind: "unmatched" };
  const date = parseIsoDate(email.date);
  if (!date) return { kind: "rejected", source: "paypal", reasons: ["invalid_date"] };
  const body = normalizedBody(email);
  const subject = extractSubjectFields(email.subject);
  const amountText = extractBodyAmount(body.text) || subject.amount;
  const amountCents = amountText ? decimalAmountToCents(amountText) : null;
  if (!amountCents) return { kind: "rejected", source: "paypal", reasons: ["invalid_amount"] };
  const merchant = cleanText(extractBodyMerchant(body.text) || subject.merchant || "", MAX_PAYEE_CHARS).replace(/\.$/, "");
  if (!merchant) return { kind: "rejected", source: "paypal", reasons: ["missing_payee"] };

  const transactionId = body.text.match(TRANSACTION_ID_PATTERN)?.[1] || null;
  const currency = detectCurrency(`${email.subject} ${body.text}`);
  const description = body.text.match(/\b(?:note to seller|purchase description|item description)[:\s]+(.+?)(?:\n|$)/i)?.[1] || "";
  const notes = cleanText([
    description,
    transactionId ? `PayPal Transaction: ${transactionId}` : "",
  ].filter(Boolean).join(" | "), MAX_NOTES_CHARS);
  const candidate: ParsedTransactionCandidate = {
    source: "paypal",
    parserVersion: PAYPAL_PARSER_VERSION,
    externalId: transactionId,
    importedId: transactionId ? `paypal-${transactionId}` : null,
    gmailAccountId: email.gmailAccountId,
    gmailMessageId: email.gmailMessageId,
    emailUid: email.uid,
    internetMessageId: email.internetMessageId || null,
    date,
    amountCents: -amountCents,
    currency,
    payee: merchant,
    notes,
    senderAuthentication: email.senderAuthentication,
    warnings: commonWarnings(email, PAYPAL_SENDERS, transactionId, currency, body.usedPlainFallback),
    evidence: [
      evidence("sender", email.from),
      evidence("subject", email.subject),
      evidence("amount", `${currency} ${(amountCents / 100).toFixed(2)}`),
      ...(email.senderAuthentication ? [{ code: "sender_authentication" as const, value: email.senderAuthentication }] : []),
      ...(transactionId ? [evidence("external_id", transactionId)] : []),
    ],
  };
  return { kind: "matched", source: "paypal", candidates: [candidate] };
}
