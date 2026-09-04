import type {
  BillCandidate,
  FinancialEmailClassification,
  FinancialIntendedOperationKind,
} from "../../shared/types/bills.ts";
import { FINANCIAL_SETTLEMENT_KINDS } from "../../shared/types/bills.ts";

export interface FinancialEmailPolicyResult {
  classification: FinancialEmailClassification;
  intended: FinancialIntendedOperationKind | null;
}

export function hasVerbatimFinancialEvidence(content: string, evidence: unknown): boolean {
  const quote = String(evidence || "").replace(/\s+/g, " ").trim();
  const source = content.replace(/\s+/g, " ");
  if (!quote) return false;
  if (source.includes(quote)) return true;
  // Models sometimes include quotation delimiters around an otherwise exact
  // excerpt. Remove only one matching outer pair, never internal punctuation
  // or connecting words between multiple excerpts.
  const pairs = [["\"", "\""], ["“", "”"], ["'", "'"], ["‘", "’"]] as const;
  return pairs.some(([open, close]) => quote.startsWith(open) && quote.endsWith(close)
    && quote.length > 2 && source.includes(quote.slice(1, -1)));
}

export function validateFinancialSemanticIdentity(candidate: BillCandidate, content: string): BillCandidate {
  const normalized = { ...candidate };
  if ((candidate.type_confidence != null || candidate.type_evidence != null)
    && (!hasStrongFinancialType(candidate) || !hasVerbatimFinancialEvidence(content, candidate.type_evidence))) {
    normalized.type = null;
    normalized.type_confidence = null;
    normalized.type_evidence = null;
  }
  if ((candidate.account_hint != null || candidate.account_hint_confidence != null)
    && !(Number(candidate.account_hint_confidence) >= 0.8
      && Number(candidate.account_hint_confidence) <= 1
      && hasVerbatimFinancialEvidence(content, candidate.account_hint))) {
    normalized.account_hint = null;
    normalized.account_hint_confidence = null;
  }
  for (const [hintKey, confidenceKey] of [
    ["from_account_hint", "from_account_hint_confidence"],
    ["to_account_hint", "to_account_hint_confidence"],
  ] as const) {
    if ((candidate[hintKey] != null || candidate[confidenceKey] != null)
      && !(Number(candidate[confidenceKey]) >= 0.8
        && Number(candidate[confidenceKey]) <= 1
        && hasVerbatimFinancialEvidence(content, candidate[hintKey]))) {
      normalized[hintKey] = null;
      normalized[confidenceKey] = null;
    }
  }
  if ((candidate.settlement_kind != null || candidate.settlement_confidence != null || candidate.settlement_evidence != null)
    && !(Number(candidate.settlement_confidence) >= 0.8
      && Number(candidate.settlement_confidence) <= 1
      && FINANCIAL_SETTLEMENT_KINDS.some((kind) => kind === candidate.settlement_kind)
      && hasVerbatimFinancialEvidence(content, candidate.settlement_evidence))) {
    normalized.settlement_kind = null;
    normalized.settlement_confidence = null;
    normalized.settlement_evidence = null;
  }
  if ((candidate.provider_reference != null || candidate.provider_reference_confidence != null || candidate.provider_reference_evidence != null)
    && !(Number(candidate.provider_reference_confidence) >= 0.8
      && Number(candidate.provider_reference_confidence) <= 1
      && hasVerbatimFinancialEvidence(content, candidate.provider_reference)
      && hasVerbatimFinancialEvidence(content, candidate.provider_reference_evidence))) {
    normalized.provider_reference = null;
    normalized.provider_reference_confidence = null;
    normalized.provider_reference_evidence = null;
  }
  return normalized;
}

function hasStrongLastFour(candidate: BillCandidate): boolean {
  const lastFour = String(candidate.account_last4 || "").replace(/\D/g, "");
  const evidence = String(candidate.account_last4_evidence || "").replace(/\D/g, "");
  return lastFour.length === 4
    && evidence.includes(lastFour)
    && Number(candidate.account_last4_confidence) >= 0.8;
}

function hasCreditAccountEvidence(candidate: BillCandidate): boolean {
  return candidate.type === "transfer"
    && (hasStrongFinancialType(candidate) || Boolean(candidate.to_account_id) || hasStrongLastFour(candidate));
}

export function hasStrongFinancialType(candidate: BillCandidate): boolean {
  return ["transfer", "bill", "expense", "income"].includes(String(candidate.type))
    && Number(candidate.type_confidence) >= 0.8
    && Number(candidate.type_confidence) <= 1
    && Boolean(String(candidate.type_evidence || "").trim());
}

export function shouldVerifyFinancialEmailType(candidate: BillCandidate): boolean {
  return ["statement_issued", "payment_due", "payment_scheduled"].includes(String(candidate.event_kind))
    && !hasStrongFinancialType(candidate)
    && !hasCreditAccountEvidence(candidate);
}

export function shouldAttemptFinancialEmailTypeVerification(candidate: BillCandidate, now = Date.now()): boolean {
  if (!shouldVerifyFinancialEmailType(candidate)) return false;
  const previous = candidate.type_verification;
  if (!previous) return true;
  if (previous.status !== "failed" || (previous.attempts ?? 1) >= 3) return false;
  const attemptedAt = Date.parse(previous.attempted_at || "");
  return !Number.isFinite(attemptedAt) || now - attemptedAt >= 5 * 60_000;
}

function hasRecurringEvidence(candidate: BillCandidate): boolean {
  return Boolean(candidate.schedule_name)
    || (candidate.type === "bill" && Boolean(candidate.due_date));
}

export function classifyFinancialEmail(candidate: BillCandidate): FinancialEmailPolicyResult {
  const eventKind = candidate.event_kind || null;
  const base = {
    eventKind,
    confidence: Number.isFinite(Number(candidate.event_confidence))
      ? Number(candidate.event_confidence)
      : null,
    ...(candidate.event_evidence ? { evidence: candidate.event_evidence } : {}),
  };
  switch (eventKind) {
    case "purchase":
      return { classification: { ...base, documentKind: "one_time_transaction", reasons: [] }, intended: "create_transaction" };
    case "refund":
    case "reward":
      return { classification: { ...base, documentKind: "income", reasons: [] }, intended: "create_transaction" };
    case "bill_issued":
      return hasRecurringEvidence(candidate)
        ? { classification: { ...base, documentKind: "utility_statement", reasons: [] }, intended: "create_schedule" }
        : { classification: { ...base, documentKind: "one_time_transaction", reasons: [] }, intended: "create_transaction" };
    case "statement_issued":
    case "payment_due":
    case "payment_scheduled":
      return hasCreditAccountEvidence(candidate)
        ? { classification: { ...base, documentKind: "credit_card_statement", reasons: [] }, intended: "create_transfer_schedule" }
        : hasStrongFinancialType(candidate) && candidate.type === "bill"
          ? { classification: { ...base, documentKind: "utility_statement", reasons: [] }, intended: "create_schedule" }
          : {
              classification: {
                ...base,
                documentKind: "informational",
                reasons: ["credit_account_evidence_missing"],
              },
              intended: null,
            };
    case "card_payment_completed":
      return { classification: { ...base, documentKind: "credit_card_statement", reasons: [] }, intended: "no_write" };
    case "payment_completed":
      return { classification: { ...base, documentKind: "utility_statement", reasons: [] }, intended: "create_transaction" };
    case "payment_cancelled":
    case "payment_failed":
      return {
        classification: { ...base, documentKind: "informational", reasons: ["informational_event"] },
        intended: "no_write",
      };
    case "account_transfer_pending":
    case "account_transfer_completed":
      return candidate.type === "income"
        ? { classification: { ...base, documentKind: "income", reasons: [] }, intended: "create_transaction" }
        : {
            classification: { ...base, documentKind: "informational", reasons: ["informational_event"] },
            intended: "no_write",
          };
    case "other":
    default:
      return {
        classification: {
          ...base,
          documentKind: "informational",
          reasons: [eventKind ? "semantic_event_ambiguous" : "semantic_event_missing"],
        },
        intended: null,
      };
  }
}
