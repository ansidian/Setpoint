export const TRANSACTION_SOURCES = ["amazon", "paypal"] as const;
export type TransactionSource = typeof TRANSACTION_SOURCES[number];

export type TransactionParseReason =
  | "missing_body"
  | "invalid_date"
  | "invalid_amount"
  | "missing_payee"
  | "ambiguous_multi_order";

export type TransactionWarningCode =
  | "untrusted_sender"
  | "missing_external_id"
  | "unsupported_currency"
  | "sender_authentication_failed"
  | "sender_authentication_unavailable"
  | "plain_text_fallback";

export interface TransactionParserWarning {
  code: TransactionWarningCode;
  blocking: boolean;
  detail: string;
}

export type TransactionEvidence =
  | { code: "sender" | "subject" | "amount" | "external_id" | "item"; value: string }
  | { code: "sender_authentication"; value: EmailAuthenticationProjection };

export interface TransactionEmailInput {
  uid: string;
  gmailAccountId: string;
  gmailMessageId: string;
  internetMessageId?: string | null;
  from: string;
  subject: string;
  date: string;
  html?: string | null;
  text?: string | null;
  senderAuthentication?: EmailAuthenticationProjection;
}

export interface ParsedTransactionCandidate {
  source: TransactionSource;
  parserVersion: string;
  externalId: string | null;
  importedId: string | null;
  gmailAccountId: string;
  gmailMessageId: string;
  emailUid: string;
  internetMessageId: string | null;
  date: string;
  amountCents: number;
  currency: string;
  payee: string;
  notes: string;
  warnings: TransactionParserWarning[];
  evidence: TransactionEvidence[];
  senderAuthentication?: EmailAuthenticationProjection;
}

export type TransactionParseResult =
  | { kind: "unmatched" }
  | { kind: "rejected"; source: TransactionSource | null; reasons: TransactionParseReason[] }
  | { kind: "matched"; source: TransactionSource; candidates: ParsedTransactionCandidate[] };

export interface AutomaticSafetyProjection {
  safe: boolean;
  blockingReasons: TransactionWarningCode[];
}

export function projectAutomaticSafety(candidate: ParsedTransactionCandidate): AutomaticSafetyProjection {
  const blockingReasons = candidate.warnings
    .filter((warning) => warning.blocking)
    .map((warning) => warning.code);

  if (!candidate.externalId && !blockingReasons.includes("missing_external_id")) {
    blockingReasons.push("missing_external_id");
  }
  if (candidate.currency !== "USD" && !blockingReasons.includes("unsupported_currency")) {
    blockingReasons.push("unsupported_currency");
  }

  return {
    safe: candidate.amountCents < 0 && Boolean(candidate.date) && blockingReasons.length === 0,
    blockingReasons,
  };
}
import type { EmailAuthenticationProjection } from "../../shared/types/email.ts";
