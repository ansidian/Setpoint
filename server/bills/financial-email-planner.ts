import { getMetadata as actualGetMetadata } from "../actual/actual.ts";
import { queryTransactions } from "../transactions/transactions-service.ts";
import { readBillsMirrorRange } from "./bills-mirror-sync.ts";
import { createBillCandidateVerificationService } from "./bill-candidate-verification-service.ts";
import {
  extractBillCandidate,
  loadBillExtractChoice,
} from "./bill-extraction-service.ts";
import { shouldVerifyBillEvent } from "./billEventVerifier.ts";
import { selectSemanticBillAmount } from "./billSemanticAmountPolicy.ts";
import { financialEmailAutomationEligibility } from "./financialEmailAutomationPolicy.ts";
import { financialEmailIdentity } from "./financialEmailIdentity.ts";
import {
  classifyFinancialEmail,
  type FinancialEmailPolicyResult,
} from "./financialEmailClassificationPolicy.ts";
import {
  inferFinancialEmailTargets,
  type FinancialTargetBundleRanker,
} from "./financialEmailTargetInference.ts";
import { resolveStatementActualStatus } from "./statementActualStatusModel.ts";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import type {
  BillCandidate,
  BillEventKind,
  BillsMirrorHealth,
  FinancialEmailInput,
  FinancialEmailOperation,
  FinancialEmailPlan,
  FinancialEmailReconciliation,
  FinancialPlanReason,
  FinancialPlanReasonCode,
  FinancialPlanTargets,
} from "../../shared/types/bills.ts";
import type { TransactionQueryResult, TransactionRecord } from "../../shared/types/transactions.ts";

interface ProjectedActualMetadata extends ActualMetadata {
  syncHealth: BillsMirrorHealth;
}

interface PlannerOccurrenceData {
  schedules: Array<{
    scheduleId: string;
    id?: string;
    name?: string;
    payee?: string;
    amount?: number;
    next_date?: string;
    paid?: boolean;
    type?: string;
  }>;
  syncHealth?: BillsMirrorHealth;
}

interface CandidateResolution {
  candidate: BillCandidate;
  providerUnavailable: boolean;
}

export interface FinancialEmailPlannerDependencies {
  candidateExtractor?: typeof extractBillCandidate;
  candidateVerification?: Pick<
    ReturnType<typeof createBillCandidateVerificationService>,
    "verifyEmailCandidate" | "selectEmailTargetPolicy"
  > & Partial<Pick<ReturnType<typeof createBillCandidateVerificationService>, "rankEmailTargetBundles">>;
  targetRanker?: FinancialTargetBundleRanker;
  modelChoiceReader?: typeof loadBillExtractChoice;
  metadataReader?: (userId: string) => Promise<ProjectedActualMetadata>;
  occurrenceReader?: (userId: string, range: { start: string; end: string }) => Promise<PlannerOccurrenceData>;
  transactionReader?: (userId: string, filters: Parameters<typeof queryTransactions>[1]) => Promise<TransactionQueryResult>;
  now?: () => Date;
}

const RECONCILABLE_EVENTS = new Set<BillEventKind>([
  "statement_issued",
  "payment_due",
  "payment_scheduled",
  "card_payment_completed",
  "payment_completed",
  "bill_issued",
]);

function reason(
  code: FinancialPlanReasonCode,
  message: string,
  field: string | null = null,
): FinancialPlanReason {
  return { code, message, ...(field ? { field } : {}), blocking: true };
}

function uniqueReasonCodes(reasons: FinancialPlanReason[]): FinancialPlanReasonCode[] {
  return [...new Set(reasons.map((item) => item.code))];
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

function evidenceReasons(
  candidate: BillCandidate,
  policy: FinancialEmailPolicyResult,
  providerUnavailable: boolean,
): FinancialPlanReason[] {
  const reasons: FinancialPlanReason[] = [];
  if (providerUnavailable) {
    reasons.push(reason("provider_unavailable", "Semantic verification is currently unavailable."));
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

function targetReasons(
  targets: FinancialPlanTargets,
  inferenceReasons: FinancialPlanReasonCode[],
  metadataAvailable: boolean,
): FinancialPlanReason[] {
  const reasons: FinancialPlanReason[] = [];
  const unresolved: Array<[
    keyof FinancialPlanTargets,
    FinancialPlanReasonCode,
    string,
    string,
  ]> = [
    ["account", "account_target_unresolved", "The Actual account could not be inferred.", "account"],
    ["payee", "payee_target_unresolved", "The Actual payee could not be inferred.", "payee"],
    ["category", "category_target_unresolved", "The Actual category could not be inferred.", "category"],
    ["fromAccount", "from_account_target_unresolved", "The funding Actual account could not be inferred.", "from_account"],
    ["toAccount", "to_account_target_unresolved", "The destination Actual account could not be inferred.", "to_account"],
    ["schedule", "schedule_target_unresolved", "The Actual schedule could not be inferred.", "schedule"],
  ];
  for (const [field, code, message, reasonField] of unresolved) {
    if (targets[field].status === "unresolved") reasons.push(reason(code, message, reasonField));
  }
  if (!metadataAvailable) {
    reasons.push(reason("actual_metadata_unavailable", "Current Actual metadata is unavailable."));
  }
  if (inferenceReasons.includes("target_evidence_conflict")) {
    reasons.push(reason("target_evidence_conflict", "Strong Actual evidence points to conflicting targets."));
  }
  if (inferenceReasons.includes("target_ranking_unresolved")) {
    reasons.push(reason("target_ranking_unresolved", "Multiple evidence-backed Actual target bundles remain plausible."));
  }
  return reasons;
}

function todayYmd(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function addDaysYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function unavailableMetadata(): ProjectedActualMetadata {
  return {
    accounts: [],
    payees: [],
    payeeMap: {},
    categories: [],
    schedules: [],
    recentTransactions: [],
    syncHealth: {
      state: "unavailable",
      lastSuccessAt: null,
      lastError: null,
    },
  };
}

function canReconcile(candidate: BillCandidate): boolean {
  if (!candidate.event_kind || !RECONCILABLE_EVENTS.has(candidate.event_kind) || !candidate.due_date) return false;
  if (candidate.type === "transfer") {
    return Boolean(candidate.to_account_id && candidate.from_account_id);
  }
  return Boolean(candidate.payee_id || candidate.payee);
}

async function reconcileCandidate(
  userId: string,
  candidate: BillCandidate,
  metadata: ProjectedActualMetadata,
  history: TransactionRecord[],
  historyAvailable: boolean,
  dependencies: Required<Pick<FinancialEmailPlannerDependencies, "occurrenceReader" | "now">>,
): Promise<FinancialEmailReconciliation> {
  const importedId = candidate.transaction_import?.importedId;
  const importedTransaction = importedId
    ? history.find((transaction) => transaction.importedId === importedId)
    : null;
  if (importedTransaction) {
    return {
      status: "already_recorded",
      disposition: "no_write",
      reason: "exact_imported_id_match",
      checkedAt: metadata.syncHealth.lastSuccessAt || null,
      evidence: {
        kind: "transaction",
        transactionId: importedTransaction.id,
        dueDate: importedTransaction.date,
        amount: importedTransaction.amount,
        account: importedTransaction.account,
      },
    };
  }
  if (!canReconcile(candidate)) {
    return {
      status: "not_checked",
      disposition: "review",
      reason: "insufficient_reconciliation_identity",
      checkedAt: null,
      evidence: null,
    };
  }
  const dueDate = candidate.due_date!;
  const occurrences = await dependencies.occurrenceReader(userId, { start: dueDate, end: dueDate })
    .catch(() => ({ schedules: [], syncHealth: { state: "unavailable" } } as PlannerOccurrenceData));
  const today = todayYmd(dependencies.now());
  const transactions = dueDate <= today
    ? history.filter((transaction) => transaction.date === dueDate)
    : [];
  const health = !historyAvailable || metadata.syncHealth.state !== "current"
    ? {
        state: "unavailable",
        lastSuccessAt: occurrences.syncHealth?.lastSuccessAt || metadata.syncHealth.lastSuccessAt || null,
        lastError: !historyAvailable ? "transaction_history_unavailable" : metadata.syncHealth.lastError || null,
      }
    : occurrences.syncHealth || metadata.syncHealth;
  const status = resolveStatementActualStatus({
    bill: candidate,
    metadata,
    occurrences: occurrences.schedules,
    transactions,
    syncHealth: health,
    today,
  });
  const disposition = status.status === "already_recorded" || status.status === "already_scheduled"
    ? "no_write"
    : status.status === "not_scheduled"
      ? "create"
      : status.status === "needs_review"
        ? "review"
        : "review";
  return { ...status, disposition };
}

function reconciliationReasons(reconciliation: FinancialEmailReconciliation): FinancialPlanReason[] {
  if (reconciliation.status === "already_recorded") {
    return [reason("already_recorded", "An exact matching Actual transaction already exists.")];
  }
  if (reconciliation.status === "already_scheduled") {
    return [reason("already_scheduled", "An exact matching Actual schedule already exists.")];
  }
  if (reconciliation.status === "needs_review" && reconciliation.disposition !== "update_existing") {
    return [reason("reconciliation_conflict", "Existing Actual activity conflicts with this plan.")];
  }
  if (reconciliation.status === "unavailable") {
    return [reason("reconciliation_unavailable", "Current Actual evidence is unavailable for reconciliation.")];
  }
  return [];
}

function reconcileUpdateDisposition(
  reconciliation: FinancialEmailReconciliation,
  targets: FinancialPlanTargets,
): FinancialEmailReconciliation {
  const safeMismatch = reconciliation.status === "needs_review"
    && (reconciliation.reason === "amount_mismatch" || reconciliation.reason === "due_date_mismatch")
    && targets.schedule.status === "resolved"
    && Boolean(targets.schedule.id)
    && reconciliation.evidence?.scheduleId === targets.schedule.id
    && !reconciliation.evidence?.conflicts?.some((field) => !["amount", "due_date"].includes(field));
  return safeMismatch
    ? { ...reconciliation, disposition: "update_existing" }
    : reconciliation;
}

function finalOperation(
  policy: FinancialEmailPolicyResult,
  evidence: FinancialPlanReason[],
  targets: FinancialPlanReason[],
  reconciliation: FinancialEmailReconciliation,
): FinancialEmailOperation {
  if (
    policy.intended === "no_write"
    && policy.classification.documentKind === "informational"
    && evidence.length === 0
  ) {
    return {
      intended: "no_write",
      kind: "no_write",
      reasons: policy.classification.reasons,
    };
  }
  if (policy.intended === "no_write" && policy.classification.documentKind === "informational") {
    return {
      intended: "no_write",
      kind: "review",
      reasons: uniqueReasonCodes(evidence),
    };
  }
  if (reconciliation.status === "already_recorded" || reconciliation.status === "already_scheduled") {
    return {
      intended: policy.intended,
      kind: "no_write",
      reasons: [reconciliation.status],
    };
  }
  if (policy.intended === "no_write") {
    return {
      intended: "no_write",
      kind: "review",
      reasons: reconciliation.status === "needs_review"
        ? ["reconciliation_conflict"]
        : ["reconciliation_unavailable"],
    };
  }
  const blocking = [...evidence, ...targets, ...reconciliationReasons(reconciliation)];
  if (!policy.intended || blocking.length) {
    return {
      intended: policy.intended,
      kind: "review",
      reasons: uniqueReasonCodes(blocking.length ? blocking : [
        reason("semantic_event_ambiguous", "The financial event remains ambiguous."),
      ]),
    };
  }
  return { intended: policy.intended, kind: policy.intended, reasons: [] };
}

function validateInput(userId: string, input: FinancialEmailInput): void {
  if (!String(userId || "").trim()) throw new TypeError("userId is required");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("financial email input is required");
  }
  if (input.candidate != null && (typeof input.candidate !== "object" || Array.isArray(input.candidate))) {
    throw new TypeError("candidate must be an object");
  }
  if (!input.candidate && !String(input.email?.body || input.email?.body_snippet || "").trim()) {
    throw new TypeError("email body or persisted candidate is required");
  }
}

async function resolveCandidate(
  userId: string,
  input: FinancialEmailInput,
  dependencies: Required<Pick<FinancialEmailPlannerDependencies, "candidateExtractor" | "candidateVerification" | "modelChoiceReader">>,
): Promise<CandidateResolution> {
  if (!input.candidate) {
    try {
      const extracted = await dependencies.candidateExtractor(userId, {
        subject: input.email?.subject,
        from: input.email?.from || input.email?.from_address,
        body: input.email?.body || input.email?.body_snippet || "",
      });
      return { candidate: extracted.candidate, providerUnavailable: false };
    } catch {
      return { candidate: {}, providerUnavailable: true };
    }
  }
  const candidate = { ...input.candidate };
  if (candidate.semantic_enrichment?.status === "complete" || !shouldVerifyBillEvent(candidate)) {
    return { candidate, providerUnavailable: false };
  }
  try {
    const choice = await dependencies.modelChoiceReader(userId);
    const verified = await dependencies.candidateVerification.verifyEmailCandidate({
      email: input.email || {},
      candidate,
      providerId: choice.provider,
      model: choice.model,
    });
    return {
      candidate: verified,
      providerUnavailable: verified.event_verification?.status === "failed",
    };
  } catch {
    return { candidate, providerUnavailable: true };
  }
}

export function createFinancialEmailPlanner({
  candidateExtractor = extractBillCandidate,
  candidateVerification: suppliedCandidateVerification,
  targetRanker,
  modelChoiceReader = loadBillExtractChoice,
  metadataReader = async (userId) => ({
    ...await actualGetMetadata(userId),
    syncHealth: { state: "current", lastSuccessAt: null },
  }),
  occurrenceReader = (userId, range) => readBillsMirrorRange(userId, range),
  transactionReader = queryTransactions,
  now = () => new Date(),
}: FinancialEmailPlannerDependencies = {}) {
  const candidateVerification = suppliedCandidateVerification || createBillCandidateVerificationService();
  return async function planFinancialEmailForUser(
    userId: string,
    input: FinancialEmailInput,
  ): Promise<FinancialEmailPlan> {
    validateInput(userId, input);
    const resolved = await resolveCandidate(userId, input, {
      candidateExtractor,
      candidateVerification,
      modelChoiceReader,
    });
    const policy = classifyFinancialEmail(resolved.candidate);
    const needsActualEvidence = policy.classification.documentKind === "credit_card_statement"
      || Boolean(policy.intended && policy.intended !== "no_write");
    const metadata = needsActualEvidence
      ? await metadataReader(userId).catch(() => unavailableMetadata())
      : { ...unavailableMetadata(), syncHealth: { state: "current", lastSuccessAt: null } };
    const metadataAvailable = metadata.syncHealth.state === "current";
    const today = todayYmd(now());
    const historyResult: TransactionQueryResult = needsActualEvidence && metadataAvailable
      ? await transactionReader(userId, {
          start: addDaysYmd(today, -365),
          end: today,
          direction: "all",
          include_transfers: true,
          limit: 1000,
        }).catch(() => ({ error: "transaction_history_unavailable" }))
      : { transactions: [] };
    const historyAvailable = !historyResult.error && !historyResult.sync_state;
    const history = historyAvailable ? historyResult.transactions || [] : [];
    const defaultRanker: FinancialTargetBundleRanker | undefined = candidateVerification.rankEmailTargetBundles
      ? async ({ candidate, options }) => {
          try {
            const choice = await modelChoiceReader(userId);
            return await candidateVerification.rankEmailTargetBundles!({
              email: input.email || {},
              candidate,
              options,
              providerId: choice.provider,
              model: choice.model,
            });
          } catch {
            return { status: "failed", key: null, confidence: null, evidence: null };
          }
        }
      : undefined;
    const inference = await inferFinancialEmailTargets({
      candidate: resolved.candidate,
      classification: policy.classification,
      intended: policy.intended,
      metadata: metadataAvailable ? metadata : unavailableMetadata(),
      history,
      rankBundles: targetRanker || defaultRanker,
    });
    const targets = inference.targets;
    const evidence = evidenceReasons(inference.candidate, policy, resolved.providerUnavailable);
    const unresolved = targetReasons(targets, inference.reasons, metadataAvailable);
    const reconciled = await reconcileCandidate(userId, inference.candidate, metadata, history, historyAvailable, {
      occurrenceReader,
      now,
    });
    const reconciliation = reconcileUpdateDisposition(reconciled, targets);
    const reconciliationReview = reconciliationReasons(reconciliation)
      .filter((item) => item.code === "reconciliation_conflict" || item.code === "reconciliation_unavailable");
    const operation = finalOperation(policy, evidence, unresolved, reconciliation);
    const completedPaymentReview = policy.intended === "no_write"
      && policy.classification.documentKind !== "informational"
      && reconciliation.status !== "already_recorded"
      && reconciliation.status !== "already_scheduled"
      ? [reconciliation.status === "needs_review"
          ? reason("reconciliation_conflict", "Existing Actual activity conflicts with this payment confirmation.")
          : reason("reconciliation_unavailable", "The completed payment could not be reconciled to Actual.")]
      : [];
    const reviewReasons = operation.kind === "no_write"
      ? []
      : policy.intended === "no_write"
        ? [...evidence, ...completedPaymentReview]
        : [...evidence, ...unresolved, ...reconciliationReview];
    return {
      version: 1,
      identity: financialEmailIdentity(userId, input),
      candidate: inference.candidate,
      classification: policy.classification,
      operation,
      targets,
      reconciliation,
      reviewReasons,
      automation: financialEmailAutomationEligibility({
        input,
        candidate: inference.candidate,
        evidence,
        targets: unresolved,
        reconciliation,
        intended: policy.intended,
      }),
    };
  };
}

const defaultPlanner = createFinancialEmailPlanner();

export function planFinancialEmail(
  userId: string,
  input: FinancialEmailInput,
): Promise<FinancialEmailPlan> {
  return defaultPlanner(userId, input);
}
