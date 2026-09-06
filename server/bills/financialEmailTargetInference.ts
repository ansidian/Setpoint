import crypto from "node:crypto";
import type {
  ActualMetadata,
  ActualSchedule,
} from "../../shared/types/actual.ts";
import type {
  BillCandidate,
  FinancialEmailClassification,
  FinancialIntendedOperationKind,
  FinancialPlanReasonCode,
  FinancialPlanTarget,
  FinancialPlanTargets,
  FinancialTargetConfidence,
  FinancialTargetKind,
  FinancialTargetProvenance,
} from "../../shared/types/bills.ts";
import type { TransactionRecord } from "../../shared/types/transactions.ts";
import type {
  FinancialTargetRankingOption,
  FinancialTargetRankingResult,
} from "./financialEmailTargetRanker.ts";
import {
  exactImportedTargetEvidence,
  type TargetEvidence,
  type TargetValue,
} from "./financialEmailImportedHistory.ts";
import {
  accountSuffix, creditCompatible, namedCreditAccountEvidence, rankedCreditAccountEvidence,
  namedAccountEvidence, rankedAccountEvidence,
  trustedAccountSuffix, scheduleAccountId, transferScheduleTopology,
  financialScheduleEvidence as scheduleEvidence,
} from "./financialEmailAccountEvidence.ts";
import { discoverCorroboratedMerchantHistory } from "./financialEmailMerchantCandidates.ts";
import { cashbackSettlementAccountEvidence, isCashbackIncome, semanticRewardCategoryEvidence, semanticRewardPayeeEvidence } from "./financialEmailRewardEvidence.ts";
import { historyBundles, stableHistoryEvidence, rankHistoryBundles, modelEvidence } from "./financialEmailHistoryEvidence.ts";
import { hasVerbatimFinancialEvidence } from "./financialEmailClassificationPolicy.ts";
export type FinancialTargetBundleRanker = (input: {
  candidate: BillCandidate;
  options: FinancialTargetRankingOption[];
}) => Promise<FinancialTargetRankingResult>;

export const FINANCIAL_TARGET_INFERENCE_VERSION = 6;

export interface FinancialTargetInferenceResult {
  candidate: BillCandidate;
  targets: FinancialPlanTargets;
  reasons: FinancialPlanReasonCode[];
}
export interface FinancialTargetInferenceInput {
  candidate: BillCandidate;
  classification: FinancialEmailClassification;
  intended: FinancialIntendedOperationKind | null;
  metadata: ActualMetadata;
  history?: TransactionRecord[];
  rankBundles?: FinancialTargetBundleRanker;
  /** Complete, already assessed source excerpts used only to ground new payees. */
  evidenceText?: string;
  allowNewPayee?: boolean;
}

function normalizeIdentity(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function opaqueKey(kind: string, value: string): string {
  return `target-${crypto.createHash("sha256").update(`${kind}:${value}`).digest("hex").slice(0, 12)}`;
}

function target(
  kind: FinancialTargetKind,
  status: FinancialPlanTarget["status"],
  value: TargetValue | null = null,
  provenance: FinancialTargetProvenance[] = [],
  competing: TargetEvidence[] = [],
): FinancialPlanTarget {
  return {
    kind,
    status,
    ...(value ? { id: value.id, label: value.label } : {}),
    provenance,
    ...(competing.length && (status === "unresolved" || competing.length > 1) ? {
        competingCandidates: competing.map((entry) => ({
          key: opaqueKey(kind, entry.id || entry.label),
          label: entry.label,
          confidence: entry.provenance.confidence,
          reason: entry.provenance.reason,
        })),
      } : {}),
  };
}
function uniqueEvidence(entries: TargetEvidence[]): TargetEvidence[] {
  const byValue = new Map<string, TargetEvidence>();
  for (const entry of entries) {
    const key = entry.id || normalizeIdentity(entry.label);
    const current = byValue.get(key);
    if (
      !current
      || (current.selectable === false && entry.selectable !== false)
      || (current.selectable !== false && entry.selectable !== false && entry.tier < current.tier)
    ) byValue.set(key, entry);
  }
  return [...byValue.values()];
}
function selectEvidence(
  kind: FinancialTargetKind,
  entries: TargetEvidence[],
): { target: FinancialPlanTarget; conflict: boolean } {
  const candidates = uniqueEvidence(entries);
  if (!candidates.length) return { target: target(kind, "unresolved"), conflict: false };
  const selectable = candidates.filter((entry) => entry.selectable !== false);
  if (!selectable.length) {
    return { target: target(kind, "unresolved", null, [], candidates), conflict: false };
  }
  const bestTier = Math.min(...selectable.map((entry) => entry.tier));
  const best = selectable.filter((entry) => entry.tier === bestTier);
  const decisiveConflicts = selectable.filter((entry) => (
    entry.decisive && !best.some((selected) => selected.id === entry.id)
      && !(["account", "from_account", "to_account"].includes(kind) && bestTier <= 2 && entry.provenance.source === "actual_history")
  ));
  if (best.length !== 1 || decisiveConflicts.length) {
    return { target: target(kind, "unresolved", null, [], candidates), conflict: true };
  }
  const selected = best[0]!;
  return {
    target: target(
      kind,
      "resolved",
      { id: selected.id, label: selected.label },
      [selected.provenance],
      candidates,
    ),
    conflict: false,
  };
}

function identityValues(candidate: BillCandidate): Set<string> {
  return new Set([
    candidate.payee,
    candidate.payee_hint,
    candidate.payee_label,
    candidate.schedule_name,
  ].map(normalizeIdentity).filter(Boolean));
}

function metadataProvenance(
  confidence: FinancialTargetConfidence,
  reason: string,
  evidence: string | null = null,
): FinancialTargetProvenance {
  return {
    source: "actual_metadata",
    confidence,
    reason,
    ...(evidence ? { evidence } : {}),
  };
}

function schedulePayeeId(schedule: ActualSchedule): string | null {
  const value = schedule.conditions?.find((condition) => (
    condition.field === "payee" || condition.field === "description"
  ))?.value;
  return typeof value === "string" ? value : null;
}

function exactSchedules(
  candidate: BillCandidate,
  metadata: ActualMetadata,
  transfer: boolean,
): ActualSchedule[] {
  const identities = identityValues(candidate);
  if (!identities.size) return [];
  return metadata.schedules.filter((schedule) => {
    if (schedule.completed) return false;
    if (transfer ? schedule.type !== "transfer" : schedule.type !== "bill") return false;
    const payeeId = schedulePayeeId(schedule);
    return identities.has(normalizeIdentity(schedule.name))
      || identities.has(normalizeIdentity(payeeId ? metadata.payeeMap[payeeId] : ""));
  });
}

function categoryValues(metadata: ActualMetadata): Map<string, TargetValue[]> {
  const values = new Map<string, TargetValue[]>();
  for (const category of metadata.categories.flatMap((group) => group.categories || [])) {
    const key = normalizeIdentity(category.name);
    const existing = values.get(key) || [];
    existing.push({ id: category.id, label: category.name });
    values.set(key, existing);
  }
  return values;
}

function directionFor(classification: FinancialEmailClassification): TransactionRecord["direction"] {
  return classification.documentKind === "income" ? "income" : "expense";
}
function matchingHistory(
  candidate: BillCandidate,
  classification: FinancialEmailClassification,
  history: TransactionRecord[],
): TransactionRecord[] {
  const identities = identityValues(candidate);
  const direction = directionFor(classification);
  return history.filter((transaction) => (
    transaction.direction === direction
    && identities.has(normalizeIdentity(transaction.payee))
  ));
}

function exactPayeeEvidence(candidate: BillCandidate, metadata: ActualMetadata): TargetEvidence[] {
  const identities = identityValues(candidate);
  return metadata.payees
    .filter((payee) => identities.has(normalizeIdentity(payee.name)))
    .map((payee) => ({
      id: payee.id,
      label: payee.name,
      tier: 2,
      decisive: true,
      provenance: metadataProvenance("exact", "exact_normalized_payee", candidate.payee || candidate.payee_hint || null),
    }));
}

function suffixAccountEvidence(
  candidate: BillCandidate,
  metadata: ActualMetadata,
  transfer: boolean,
): TargetEvidence[] {
  const lastFour = trustedAccountSuffix(candidate);
  if (!lastFour) return [];
  return metadata.accounts
    .filter((account) => (!transfer || creditCompatible(account)) && accountSuffix(account.name) === lastFour)
    .map((account) => ({
      id: account.id,
      label: account.name,
      tier: 1,
      decisive: true,
      provenance: metadataProvenance("exact", "unique_account_last_four", candidate.account_last4_evidence || null),
    }));
}

function derivedScheduleTarget(label: string): FinancialPlanTarget {
  return target("schedule", "resolved", { id: null, label }, [{
    source: "deterministic_policy",
    confidence: "high",
    reason: "derived_from_selected_actual_target",
  }]);
}
function targetValue(planTarget: FinancialPlanTarget): TargetValue | null {
  return planTarget.status === "resolved" && planTarget.label
    ? { id: planTarget.id || null, label: planTarget.label }
    : null;
}

function blankTargets(): FinancialPlanTargets {
  return {
    account: target("account", "not_applicable"),
    payee: target("payee", "not_applicable"),
    category: target("category", "not_applicable"),
    fromAccount: target("from_account", "not_applicable"),
    toAccount: target("to_account", "not_applicable"),
    schedule: target("schedule", "not_applicable"),
  };
}

function inferredCandidate(candidate: BillCandidate, targets: FinancialPlanTargets): BillCandidate {
  const next: BillCandidate = {
    ...candidate,
    payee_id: null,
    account_id: null,
    category_id: null,
    from_account_id: null,
    to_account_id: null,
    schedule_name: null,
  };
  if (targets.account.status === "resolved") next.account_id = targets.account.id || null;
  if (targets.payee.status === "resolved") {
    next.payee_id = targets.payee.id || null;
    next.payee = targets.payee.label || next.payee;
  }
  if (targets.category.status === "resolved") next.category_id = targets.category.id || null;
  if (targets.fromAccount.status === "resolved") next.from_account_id = targets.fromAccount.id || null;
  if (targets.toAccount.status === "resolved") next.to_account_id = targets.toAccount.id || null;
  if (targets.schedule.status === "resolved") next.schedule_name = targets.schedule.label || null;
  return next;
}
export async function inferFinancialEmailTargets({
  candidate,
  classification,
  intended,
  metadata,
  history = [],
  rankBundles,
  evidenceText = "",
  allowNewPayee = false,
}: FinancialTargetInferenceInput): Promise<FinancialTargetInferenceResult> {
  const targets = blankTargets();
  const reasons = new Set<FinancialPlanReasonCode>();
  const transfer = classification.documentKind === "credit_card_statement" || intended === "create_transfer";
  const actionable = intended && intended !== "no_write";
  const reconciliationTransfer = transfer && candidate.event_kind === "card_payment_completed";
  if (!actionable && !reconciliationTransfer) {
    return { candidate: inferredCandidate(candidate, targets), targets, reasons: [] };
  }

  const schedules = exactSchedules(candidate, metadata, transfer);
  const categories = categoryValues(metadata);
  if (transfer) {
    let toSelection = selectEvidence("to_account", [
      ...namedAccountEvidence(candidate, metadata, "to_account", evidenceText),
      ...(candidate.event_kind === "account_transfer_completed" ? [] : [
        ...suffixAccountEvidence(candidate, metadata, true),
        ...namedCreditAccountEvidence(candidate, metadata),
      ]),
      ...scheduleEvidence(schedules, metadata, "to_account"),
    ]);
    if (toSelection.target.status === "unresolved" && !toSelection.conflict && rankBundles) {
      const explicit = await rankedAccountEvidence(candidate, metadata, "to_account", evidenceText, rankBundles);
      toSelection = selectEvidence("to_account", explicit.length || candidate.event_kind === "account_transfer_completed"
        ? explicit : await rankedCreditAccountEvidence(candidate, metadata, rankBundles));
    }
    targets.toAccount = toSelection.target;
    if (toSelection.conflict) reasons.add("target_evidence_conflict");

    const destination = targetValue(targets.toAccount);
    const accountSchedules = destination?.id ? metadata.schedules.filter((schedule) => (
      !schedule.completed && transferScheduleTopology(schedule)?.toAccountId === destination.id
    )) : schedules;
    if (destination?.id && metadata.schedules.some((schedule) => {
      const expectedName = normalizeIdentity(`${destination.label} Payment`);
      const related = schedules.includes(schedule) || normalizeIdentity(schedule.name) === expectedName;
      return !schedule.completed && schedule.type === "transfer" && related
        && (scheduleAccountId(schedule) === destination.id || schedule.transferAccountId === destination.id)
        && transferScheduleTopology(schedule)?.toAccountId !== destination.id;
    })) reasons.add("target_evidence_conflict");
    const datedSchedules = accountSchedules.filter((schedule) => schedule.next_date === candidate.due_date);
    const transferSchedules = datedSchedules.length ? datedSchedules : accountSchedules;
    const transferRows = destination?.id
      ? history.filter((row) => (
          row.transferAccountId
          && ((row.accountId === destination.id && row.direction === "income")
            || (row.transferAccountId === destination.id && row.direction === "expense"))
        ))
      : [];
    const historySources = transferRows.flatMap((row) => {
      const sourceId = row.accountId === destination?.id ? row.transferAccountId : row.accountId;
      const account = metadata.accounts.find((item) => item.id === sourceId);
      return account ? [{ id: account.id, label: account.name }] : [];
    });
    let sourceSelection = selectEvidence("from_account", [
      ...namedAccountEvidence(candidate, metadata, "from_account", evidenceText),
      ...scheduleEvidence(transferSchedules, metadata, "from_account"),
      ...stableHistoryEvidence("from_account", historySources, transferRows.length),
    ]);
    if (sourceSelection.target.status === "unresolved" && !sourceSelection.conflict) {
      const ranked = await rankedAccountEvidence(candidate, metadata, "from_account", evidenceText, rankBundles);
      if (ranked.length) sourceSelection = selectEvidence("from_account", ranked);
    }
    targets.fromAccount = sourceSelection.target;
    if (sourceSelection.conflict) reasons.add("target_evidence_conflict");

    if (intended !== "create_transfer") {
      const scheduleSelection = selectEvidence("schedule", scheduleEvidence(transferSchedules, metadata, "schedule"));
      targets.schedule = scheduleSelection.target;
      if (scheduleSelection.conflict) reasons.add("target_evidence_conflict");
      if (targets.schedule.status === "unresolved" && targets.toAccount.status === "resolved" && !transferSchedules.length) {
        targets.schedule = derivedScheduleTarget(`${targets.toAccount.label} Payment`);
      }
    }
    return {
      candidate: inferredCandidate(candidate, targets),
      targets,
      reasons: [...reasons],
    };
  }

  targets.account = target("account", "unresolved");
  targets.payee = target("payee", "unresolved");
  targets.category = target("category", "unresolved");
  if (intended === "create_schedule") targets.schedule = target("schedule", "unresolved");

  const exactImport = exactImportedTargetEvidence(candidate, history, metadata);
  const exactRows = isCashbackIncome(candidate)
    ? history.filter((transaction) => transaction.direction === "income" && ["cashback", "cash back"].includes(normalizeIdentity(transaction.payee)))
    : matchingHistory(candidate, classification, history);
  const settlementAccounts = cashbackSettlementAccountEvidence(candidate, metadata, history);
  const suffixAccounts = settlementAccounts.length && candidate.settlement_kind !== "statement_credit"
    ? []
    : suffixAccountEvidence(candidate, metadata, false);
  const constrainedAccountId = suffixAccounts.length === 1 ? suffixAccounts[0]!.id : null;
  const semanticRows = exactRows.length ? [] : discoverCorroboratedMerchantHistory({
    candidate,
    payees: metadata.payees,
    history,
    direction: directionFor(classification),
    accountId: constrainedAccountId,
  });
  const semanticSelectionRequired = exactRows.length === 0 && semanticRows.length > 0;
  const rows = exactRows.length ? exactRows : semanticRows;
  const completeRows = rows.filter((row) => row.accountId && row.payeeId);
  // Optional categories cannot split evidence for the money's account/payee.
  const bundles = historyBundles(completeRows);
  const stableBundle = !semanticSelectionRequired
    && rows.length >= 2 && completeRows.length === rows.length && bundles.length === 1
    ? bundles[0]!
    : null;
  const rankedBundle = stableBundle ? null : await rankHistoryBundles(
    candidate,
    bundles,
    rankBundles,
    { allowSingle: semanticSelectionRequired },
  );
  if (!stableBundle && bundles.length > (semanticSelectionRequired ? 0 : 1) && !rankedBundle) {
    reasons.add("target_ranking_unresolved");
  }
  const bundle = stableBundle || rankedBundle?.bundle || null;
  const bundleEvidence = bundle
    ? rankedBundle
      ? {
          account: modelEvidence(bundle.account, rankedBundle.ranking.evidence),
          payee: modelEvidence(bundle.payee, rankedBundle.ranking.evidence),
        }
      : {
          account: stableHistoryEvidence("account", completeRows.map((row) => ({ id: row.accountId!, label: row.account })), rows.length)[0] || null,
          payee: stableHistoryEvidence("payee", completeRows.map((row) => ({ id: row.payeeId!, label: row.payee })), rows.length)[0] || null,
        }
    : null;
  const accountHistoryEvidence = bundleEvidence?.account
    ? [bundleEvidence.account]
    : stableHistoryEvidence(
        "account",
        semanticSelectionRequired ? [] : completeRows.map((row) => ({ id: row.accountId!, label: row.account })),
        semanticSelectionRequired ? 0 : rows.length,
      );
  const payeeHistoryEvidence = bundleEvidence?.payee
    ? [bundleEvidence.payee]
    : stableHistoryEvidence(
        "payee",
        semanticSelectionRequired ? [] : completeRows.map((row) => ({ id: row.payeeId!, label: row.payee })),
        semanticSelectionRequired ? 0 : rows.length,
      );

  const accountSelection = selectEvidence("account", [
    ...exactImport.account,
    ...settlementAccounts,
    ...suffixAccounts,
    ...namedAccountEvidence(candidate, metadata, "account", evidenceText),
    ...namedCreditAccountEvidence(candidate, metadata),
    ...scheduleEvidence(schedules, metadata, "account"),
    ...accountHistoryEvidence,
  ]);
  targets.account = accountSelection.target;
  if (accountSelection.conflict) reasons.add("target_evidence_conflict");
  if (targets.account.status === "unresolved" && !accountSelection.conflict) {
    const ranked = await rankedAccountEvidence(candidate, metadata, "account", evidenceText, rankBundles);
    if (ranked.length) targets.account = selectEvidence("account", ranked).target;
  }

  const payeeSelection = selectEvidence("payee", [
    ...exactImport.payee,
    ...scheduleEvidence(schedules, metadata, "payee"),
    ...exactPayeeEvidence(candidate, metadata),
    ...semanticRewardPayeeEvidence(candidate, metadata),
    ...payeeHistoryEvidence,
  ]);
  targets.payee = payeeSelection.target;
  if (payeeSelection.conflict) reasons.add("target_evidence_conflict");
  const newPayee = String(candidate.payee_hint || candidate.payee || "").trim();
  if (allowNewPayee && targets.payee.status === "unresolved" && !payeeSelection.conflict
    && !targets.payee.competingCandidates?.length && newPayee.length > 1 && newPayee.length <= 200
    && hasVerbatimFinancialEvidence(evidenceText, newPayee)) {
    targets.payee = target("payee", "resolved", { id: null, label: newPayee }, [{
      source: "source_adapter", confidence: "exact", reason: "grounded_new_payee", evidence: newPayee,
    }]);
  }

  if (targets.account.status === "resolved" && targets.payee.status === "resolved") {
    const conditionalRows = rows.filter((row) => (
      row.accountId === targets.account.id && row.payeeId === targets.payee.id
    ));
    const categoryEvidence = stableHistoryEvidence(
      "category",
      conditionalRows.flatMap((row) => {
        const matches = categories.get(normalizeIdentity(row.category)) || [];
        return matches.length === 1 ? [matches[0]!] : [];
      }),
      conditionalRows.length,
    );
    categoryEvidence.push(...exactImport.category);
    categoryEvidence.push(...semanticRewardCategoryEvidence(candidate, metadata));
    const categorySelection = selectEvidence("category", categoryEvidence);
    targets.category = categorySelection.target;
    // Independently grounded required targets satisfy history ranking. A missing
    // or conflicting category remains optional for every operation and source.
    reasons.delete("target_ranking_unresolved");
  }

  if (intended === "create_schedule") {
    const scheduleSelection = selectEvidence("schedule", scheduleEvidence(schedules, metadata, "schedule"));
    targets.schedule = scheduleSelection.target;
    if (scheduleSelection.conflict) reasons.add("target_evidence_conflict");
    if (targets.schedule.status === "unresolved" && targets.payee.status === "resolved" && !schedules.length) {
      targets.schedule = derivedScheduleTarget(targets.payee.label || candidate.payee || "Scheduled payment");
    }
  }

  return {
    candidate: inferredCandidate(candidate, targets),
    targets,
    reasons: [...reasons],
  };
}
