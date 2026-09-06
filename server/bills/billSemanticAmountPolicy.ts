import {
  BILL_AMOUNT_KINDS,
  type BillAmountCandidate,
  type BillCandidate,
} from "../../shared/types/bills.ts";

export interface SemanticBillAmount {
  amount: number;
  source: string;
  kind: BillCandidate["amount_kind"];
}

interface SemanticAmountResolution {
  selection: SemanticBillAmount | null;
  ambiguous: boolean;
}

function resolveSemanticBillAmount(candidate: BillCandidate): SemanticAmountResolution {
  const unresolved = { selection: null, ambiguous: false };
  if (candidate.amount_verification?.status === "failed") return unresolved;
  const candidates = Array.isArray(candidate.amount_candidates)
    ? candidate.amount_candidates.filter((item): item is BillAmountCandidate => (
        !!item
        && typeof item === "object"
        && BILL_AMOUNT_KINDS.includes(item.kind)
        && item.value != null
        && Number.isFinite(Number(item.value))
      ))
    : [];
  const eventKind = String(candidate.event_kind || "");
  const paymentEvent = ["payment_scheduled", "payment_completed", "card_payment_completed", "account_transfer_pending", "account_transfer_completed"].includes(eventKind);
  const statementAmountAllowed = !eventKind || ["statement_issued", "payment_due", "payment_scheduled", "bill_issued"].includes(eventKind);
  const allowedCandidates = candidates.filter((item) => item.kind !== "minimum_due"
    && (statementAmountAllowed || item.kind !== "statement_balance"));
  const priorityKind = paymentEvent && allowedCandidates.some((item) => item.kind === "payment_amount")
    ? "payment_amount"
    : statementAmountAllowed && allowedCandidates.some((item) => item.kind === "statement_balance")
      ? "statement_balance"
      : null;
  const preferred = candidate.amount_kind && BILL_AMOUNT_KINDS.includes(candidate.amount_kind)
    ? allowedCandidates.filter((item) => item.kind === candidate.amount_kind)
    : [];
  const fallback = allowedCandidates.filter((item) => item.kind !== "other" && item.kind !== "subtotal");
  const choices = (priorityKind
    ? allowedCandidates.filter((item) => item.kind === priorityKind)
    : preferred.length ? preferred : fallback)
    .sort((left, right) => Number(right.confidence ?? -1) - Number(left.confidence ?? -1));
  const highest = choices[0];
  const sameKind = choices.filter((item) => item.kind === highest?.kind);
  const distinctValues = new Set(sameKind.map((item) => Number(item.value)));
  const selected = distinctValues.size > 1
    ? sameKind.find((item) => candidate.amount != null && item.kind === candidate.amount_kind
      && Number(item.value) === Number(candidate.amount))
    : highest;
  // Confidence ranks semantic roles, but cannot choose among several payments or
  // totals with the same role. Only an explicit, corroborated selection resolves it.
  if (distinctValues.size > 1 && !selected) return { selection: null, ambiguous: true };
  if (selected) {
    return {
      selection: { amount: Number(selected.value), source: `semantic:${selected.kind}`, kind: selected.kind },
      ambiguous: false,
    };
  }
  if (
    candidate.amount_kind
    && BILL_AMOUNT_KINDS.includes(candidate.amount_kind)
    && candidate.amount_kind !== "minimum_due"
    && (statementAmountAllowed || candidate.amount_kind !== "statement_balance")
    && candidates.length === 0
    && candidate.amount != null
    && Number.isFinite(Number(candidate.amount))
  ) {
    return {
      selection: { amount: Number(candidate.amount), source: `semantic:${candidate.amount_kind}`, kind: candidate.amount_kind },
      ambiguous: false,
    };
  }
  return unresolved;
}

export function selectSemanticBillAmount(candidate: BillCandidate): SemanticBillAmount | null {
  return resolveSemanticBillAmount(candidate).selection;
}

export function hasAmbiguousSemanticBillAmount(candidate: BillCandidate): boolean {
  return resolveSemanticBillAmount(candidate).ambiguous;
}
