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

export function selectSemanticBillAmount(candidate: BillCandidate): SemanticBillAmount | null {
  if (candidate.amount_verification?.status === "failed") return null;
  const candidates = Array.isArray(candidate.amount_candidates)
    ? candidate.amount_candidates.filter((item): item is BillAmountCandidate => (
        !!item
        && typeof item === "object"
        && BILL_AMOUNT_KINDS.includes(item.kind)
        && Number.isFinite(Number(item.value))
      ))
    : [];
  const statementBalance = candidates
    .filter((item) => item.kind === "statement_balance")
    .sort((left, right) => Number(right.confidence ?? -1) - Number(left.confidence ?? -1))[0];
  if (statementBalance) {
    return {
      amount: Number(statementBalance.value),
      source: "semantic:statement_balance",
      kind: "statement_balance",
    };
  }
  if (candidate.amount_kind === "minimum_due") return null;
  const preferred = candidate.amount_kind && BILL_AMOUNT_KINDS.includes(candidate.amount_kind)
    ? candidates.filter((item) => item.kind === candidate.amount_kind)
    : candidates.filter((item) => item.kind !== "minimum_due");
  const selected = preferred
    .sort((left, right) => Number(right.confidence ?? -1) - Number(left.confidence ?? -1))[0];
  if (selected) {
    return {
      amount: Number(selected.value),
      source: `semantic:${selected.kind}`,
      kind: selected.kind,
    };
  }
  if (
    candidate.amount_kind
    && BILL_AMOUNT_KINDS.includes(candidate.amount_kind)
    && Number.isFinite(Number(candidate.amount))
  ) {
    return {
      amount: Number(candidate.amount),
      source: `semantic:${candidate.amount_kind}`,
      kind: candidate.amount_kind,
    };
  }
  return null;
}
