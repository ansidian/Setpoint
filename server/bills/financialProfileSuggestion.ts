import type { ActualMetadata } from "../../shared/types/actual.ts";
import type { BillCandidate, FinancialEmailInput, FinancialIntendedOperationKind, FinancialPlanReasonCode, FinancialPlanTarget, FinancialPlanTargets } from "../../shared/types/bills.ts";
import type { FinancialProfileDraft, FinancialProfileResolution, FinancialProfileTarget } from "../../shared/types/financial-profiles.ts";
import { financialProfileCardIdentity } from "./financialProfilePlanning.ts";
import { hasVerbatimFinancialEvidence, isIgnoredFinancialNotice } from "./financialEmailClassificationPolicy.ts";
import { validateFinancialProfiles } from "./financial-profiles.ts";

function resolvedId(target: FinancialPlanTarget): string | null {
  return target.status === "resolved" && target.id && !target.competingCandidates?.length ? target.id : null;
}

function suggestedTarget(candidate: BillCandidate, intended: FinancialIntendedOperationKind | null, targets: FinancialPlanTargets): FinancialProfileTarget | null {
  if (candidate.type === "bill" && intended === "create_schedule"
    && ["bill_issued", "statement_issued"].includes(String(candidate.event_kind))) {
    const scheduleId = resolvedId(targets.schedule);
    return scheduleId ? { kind: "utility", scheduleId } : null;
  }
  if (candidate.type === "transfer" && candidate.event_kind === "payment_scheduled" && intended === "create_transfer_schedule") {
    const fromAccountId = resolvedId(targets.fromAccount);
    const toAccountId = resolvedId(targets.toAccount);
    const scheduleId = resolvedId(targets.schedule);
    if (targets.schedule.competingCandidates?.length) return null;
    return fromAccountId && toAccountId
      ? { kind: "card_payment", fromAccountId, toAccountId, ...(scheduleId ? { scheduleId } : {}) } : null;
  }
  if ((candidate.type === "expense" || candidate.type === "income") && intended === "create_transaction") {
    const accountId = resolvedId(targets.account);
    const payeeId = resolvedId(targets.payee);
    const categoryId = resolvedId(targets.category);
    return accountId && payeeId
      ? { kind: candidate.type, accountId, payeeId, ...(categoryId ? { categoryId } : {}) } : null;
  }
  return null;
}

/** Project existing destinations into an unsaved draft; never grant automation authority. */
export function suggestFinancialProfile({ input, candidate, intended, targets, resolution, metadata, reasons }: {
  input: FinancialEmailInput;
  candidate: BillCandidate;
  intended: FinancialIntendedOperationKind | null;
  targets: FinancialPlanTargets;
  resolution: FinancialProfileResolution;
  metadata: ActualMetadata | null;
  reasons: FinancialPlanReasonCode[];
}): FinancialProfileDraft | undefined {
  if (resolution.status !== "missing" || !resolution.budgetId || !metadata || isIgnoredFinancialNotice(candidate)
    || reasons.includes("target_evidence_conflict") || reasons.includes("target_ranking_unresolved")) return undefined;
  const target = suggestedTarget(candidate, intended, targets);
  const sender = input.sourceIdentity?.senderAddress?.trim().toLowerCase();
  if (!target || !sender) return undefined;
  const content = `${input.email?.subject || ""}\n${input.email?.body || input.email?.body_snippet || ""}`;
  const merchant = [candidate.payee_hint, candidate.payee]
    .find(value => typeof value === "string" && value.trim() && hasVerbatimFinancialEvidence(content, value));
  const { suffix, evidence } = financialProfileCardIdentity(candidate, content);
  const name = target.kind === "utility"
    ? metadata.schedules.find(schedule => schedule.id === target.scheduleId)?.name || "Utility bill"
    : target.kind === "card_payment"
      ? `${metadata.accounts.find(account => account.id === target.toAccountId)?.name || "Card"} payment`
      : metadata.payees.find(payee => payee.id === target.payeeId)?.name || "Financial activity";
  const draft: FinancialProfileDraft = {
    name: name.slice(0, 120), budgetId: resolution.budgetId, senderAddresses: [sender], target,
    ...(merchant ? { merchantName: merchant.trim() } : {}),
    ...(suffix && hasVerbatimFinancialEvidence(content, evidence) ? { accountLast4: suffix } : {}),
  };
  // The same current-target validation used for enabling a profile excludes
  // new-payee placeholders, closed accounts and incompatible schedule topology.
  const validation = validateFinancialProfiles([{ ...draft, id: "suggested-profile", enabled: true }], {
    budgetId: resolution.budgetId, metadata,
  });
  return validation.valid ? draft : undefined;
}
