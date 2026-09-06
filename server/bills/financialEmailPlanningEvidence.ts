import type { BillCandidate, FinancialPlanReason, FinancialPlanReasonCode } from "../../shared/types/bills.ts";
import type { FinancialEmailPolicyResult } from "./financialEmailClassificationPolicy.ts";
import { selectSemanticBillAmount } from "./billSemanticAmountPolicy.ts";

function reason(code: FinancialPlanReasonCode, message: string, field: string | null = null): FinancialPlanReason {
  return { code, message, ...(field ? { field } : {}), blocking: true };
}

function minimumDueOnly(candidate: BillCandidate): boolean {
  const candidates = candidate.amount_candidates || [];
  return candidate.amount_kind === "minimum_due"
    && !candidates.some((item) => item.kind !== "minimum_due" && Number.isFinite(Number(item.value)));
}

function usableSemanticEvent(candidate: BillCandidate): boolean {
  return Boolean(
    candidate.event_kind
    && candidate.event_kind !== "other"
    && Number(candidate.event_confidence) >= 0.7
    && String(candidate.event_evidence || "").trim(),
  );
}

function validYmd(value: unknown): boolean {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function evidenceReasons(
  candidate: BillCandidate,
  policy: FinancialEmailPolicyResult,
  providerUnavailable: boolean,
): FinancialPlanReason[] {
  const reasons: FinancialPlanReason[] = [];
  if (providerUnavailable) {
    reasons.push(reason("provider_unavailable", "Semantic verification is currently unavailable."));
  }
  if (policy.classification.reasons.includes("credit_account_evidence_missing")) {
    reasons.push(reason("semantic_event_ambiguous", "The email does not establish whether this is a card payment or a bill.", "type"));
  }
  if (policy.classification.reasons.includes("semantic_event_ambiguous")) {
    reasons.push(reason("semantic_event_ambiguous", "The payment purpose and financial event do not agree.", "event_kind"));
  }
  if (!candidate.event_kind) {
    reasons.push(reason("semantic_event_missing", "The financial event could not be established.", "event_kind"));
  } else if (!usableSemanticEvent(candidate)) {
    reasons.push(reason("semantic_event_ambiguous", "The financial event remains ambiguous.", "event_kind"));
  }
  if (policy.intended && policy.intended !== "no_write") {
    const semanticAmount = selectSemanticBillAmount(candidate);
    if (minimumDueOnly(candidate)) {
      reasons.push(reason("minimum_due_only", "A minimum due amount is informational and cannot be used for a write.", "amount"));
    } else if (!semanticAmount || semanticAmount.amount <= 0) {
      reasons.push(reason("canonical_amount_missing", "A non-minimum canonical amount is required.", "amount"));
    }
    if (!candidate.due_date) {
      reasons.push(reason("due_date_missing", "A valid transaction or schedule date is required.", "due_date"));
    } else if (!validYmd(candidate.due_date)) {
      reasons.push(reason("due_date_invalid", "The transaction or schedule date is not a valid YYYY-MM-DD date.", "due_date"));
    }
  }
  return reasons;
}
