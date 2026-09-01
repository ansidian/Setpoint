import type {
  BillCandidate,
  FinancialEmailClassification,
  FinancialIntendedOperationKind,
} from "../../shared/types/bills.ts";

export interface FinancialEmailPolicyResult {
  classification: FinancialEmailClassification;
  intended: FinancialIntendedOperationKind | null;
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
    && (Boolean(candidate.to_account_id) || hasStrongLastFour(candidate));
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
        : {
            classification: {
              ...base,
              documentKind: "utility_statement",
              reasons: ["credit_account_evidence_missing"],
            },
            intended: "create_schedule",
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
