import type { ActualMetadata } from "../../shared/types/actual.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { TransactionRecord } from "../../shared/types/transactions.ts";
import type { TargetEvidence, TargetValue } from "./financialEmailImportedHistory.ts";

function normalizeIdentity(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function semanticRewardPayeeEvidence(
  candidate: BillCandidate,
  metadata: ActualMetadata,
): TargetEvidence[] {
  if (!isCashbackIncome(candidate)) return [];
  const evidence = normalizeIdentity([
    candidate.event_evidence,
    candidate.payee_hint,
    candidate.payee,
  ].filter(Boolean).join(" "));
  if (!/(?:^| )(?:cashback|cash back|cash amount)(?: |$)/.test(evidence)) return [];
  return metadata.payees
    .filter((payee) => ["cashback", "cash back"].includes(normalizeIdentity(payee.name)))
    .map((payee) => ({
      id: payee.id,
      label: payee.name,
      tier: 2,
      decisive: true,
      provenance: {
        source: "actual_metadata",
        confidence: "exact",
        reason: "semantic_reward_payee",
        evidence: candidate.event_evidence,
      },
    }));
}

function isPayPalBalanceMovement(candidate: BillCandidate): boolean {
  return ["account_transfer_pending", "account_transfer_completed"].includes(String(candidate.event_kind || ""))
    && Number(candidate.from_account_hint_confidence) >= 0.8
    && Number(candidate.to_account_hint_confidence) >= 0.8
    && normalizeIdentity(candidate.from_account_hint).includes("paypal balance")
    && Boolean(normalizeIdentity(candidate.to_account_hint));
}

function usesPayPalCashbackDefault(candidate: BillCandidate): boolean {
  if (!isPayPalBalanceMovement(candidate)) return false;
  const source = normalizeIdentity(candidate.payee || candidate.payee_hint);
  return !source || ["paypal", "paypal balance", "cashback", "cash back"].includes(source);
}

export function isCashbackIncome(candidate: BillCandidate): boolean {
  if (usesPayPalCashbackDefault(candidate)) return true;
  if (candidate.event_kind !== "reward"
    || Number(candidate.event_confidence) < 0.8
    || !String(candidate.event_evidence || "").trim()) return false;
  const evidence = normalizeIdentity([
    candidate.event_evidence,
    candidate.payee_hint,
    candidate.payee,
  ].filter(Boolean).join(" "));
  return /(?:^| )(?:cashback|cash back|cash amount)(?: |$)/.test(evidence);
}

export function applyOwnerFinancialEmailPolicy(candidate: BillCandidate): BillCandidate {
  const next = { ...candidate };
  if (isPayPalBalanceMovement(next)) {
    next.type = "income";
    if (usesPayPalCashbackDefault(next)) next.payee = "Cashback";
    next.settlement_kind = "balance_to_bank";
    next.settlement_confidence = Math.max(Number(next.settlement_confidence) || 0, 0.99);
    next.settlement_evidence = next.settlement_evidence || next.from_account_hint || null;
  }

  const chaseEvidence = normalizeIdentity([next.payee, next.payee_hint, next.account_hint].filter(Boolean).join(" "));
  if (next.event_kind === "reward"
    && chaseEvidence.includes("chase")
    && Number(next.provider_reference_confidence) >= 0.8) {
    const reference = String(next.provider_reference || "").trim().toUpperCase();
    if (reference.startsWith("SC")) next.settlement_kind = "statement_credit";
    if (reference.startsWith("CB")) next.settlement_kind = "bank_deposit";
    if (next.settlement_kind) {
      next.settlement_confidence = Math.max(Number(next.settlement_confidence) || 0, 0.99);
      next.settlement_evidence = next.provider_reference_evidence || next.provider_reference || null;
    }
  }
  return next;
}

export function semanticRewardCategoryEvidence(
  candidate: BillCandidate,
  metadata: ActualMetadata,
): TargetEvidence[] {
  if (!isCashbackIncome(candidate)) return [];
  return metadata.categories.flatMap((group) => group.categories || [])
    .filter((category) => ["cashback", "cash back"].includes(normalizeIdentity(category.name)))
    .map((category) => ({
      id: category.id,
      label: category.name,
      tier: 2 as const,
      decisive: true,
      provenance: {
        source: "deterministic_policy" as const,
        confidence: "exact" as const,
        reason: "owner_cashback_category",
        evidence: candidate.event_evidence || candidate.from_account_hint || null,
      },
    }));
}

function stableValue(values: TargetValue[]): TargetValue | null {
  if (values.length < 2) return null;
  const unique = new Map(values.map((value) => [value.id || value.label, value]));
  return unique.size === 1 ? values[0]! : null;
}

export function cashbackSettlementAccountEvidence(
  candidate: BillCandidate,
  metadata: ActualMetadata,
  history: TransactionRecord[],
): TargetEvidence[] {
  if (!isCashbackIncome(candidate)) return [];
  if (candidate.settlement_kind === "statement_credit") return [];
  if (!["bank_deposit", "balance_to_bank"].includes(String(candidate.settlement_kind || ""))) return [];

  const hintedSuffix = String(candidate.to_account_hint || "").match(/(?:^|\D)(\d{4})(?:\D|$)/)?.[1] || null;
  const hinted = hintedSuffix && Number(candidate.to_account_hint_confidence) >= 0.8
    ? metadata.accounts.filter((account) => String(account.name).match(/(?:^|\D)(\d{4})\)?\s*$/)?.[1] === hintedSuffix)
    : [];
  if (hinted.length === 1) {
    return [{
      id: hinted[0]!.id,
      label: hinted[0]!.name,
      tier: 1,
      decisive: true,
      provenance: {
        source: "actual_metadata",
        confidence: "exact",
        reason: "cashback_destination_last_four",
        evidence: candidate.to_account_hint || null,
      },
    }];
  }

  const bankAccountIds = new Set(metadata.accounts
    .filter((account) => ["checking", "savings", "cash"].includes(String(account.type || "").toLowerCase()))
    .map((account) => account.id));
  const historical = history.flatMap((row) => row.direction === "income"
    && row.accountId && row.payeeId
    && bankAccountIds.has(row.accountId)
    && ["cashback", "cash back"].includes(normalizeIdentity(row.payee))
      ? [{ id: row.accountId, label: row.account }]
      : []);
  const selected = stableValue(historical);
  return selected ? [{
    ...selected,
    tier: 3,
    decisive: true,
    provenance: {
      source: "actual_history",
      confidence: "high",
      reason: "stable_cashback_bank_destination",
    },
  }] : [];
}
