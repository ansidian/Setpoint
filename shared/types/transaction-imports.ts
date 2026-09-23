import type { ActualFinancialSplit } from "./financial-operations.ts";
import type { FinancialEmailPlan, FinancialOperationKind, FinancialPlanReasonCode } from "./bills.ts";
import type { FinancialCorrectionDraft } from "./financial-corrections.ts";
import type { FinancialActivity, FinancialWriteEvidence } from "./financial-activity.ts";

export type TransactionImportSource = "amazon" | "paypal" | "generic";

export type TransactionImportExecutionMode = "observe" | "automatic";

export type TransactionImportRunTrigger = "historical_scan" | "arrival";
export type TransactionImportRunStatus = "queued" | "running" | "retry" | "paused" | "completed" | "failed";
export type TransactionImportItemStatus =
  | "needs_review"
  | "queued"
  | "reconciling"
  | "ready"
  | "importing"
  | "added"
  | "updated"
  | "already_present"
  | "failed"
  | "paused"
  | "dismissed";

export type TransactionImportReconciliationStatus =
  | "would_add"
  | "would_update"
  | "already_present"
  | "added"
  | "updated"
  | "failed";

export interface TransactionImportPlanTargetComparison {
  liveId: string | null;
  plannedId: string | null;
  agreement: "match" | "mismatch" | "unresolved";
}

export interface TransactionImportPlanShadow {
  status: "planned" | "not_plannable" | "failed";
  operation: FinancialOperationKind | null;
  reconciliationStatus: FinancialEmailPlan["reconciliation"]["status"] | null;
  account: TransactionImportPlanTargetComparison;
  category: TransactionImportPlanTargetComparison;
  automationEligible: boolean;
  automationReasons: FinancialPlanReasonCode[];
  failureCode: string | null;
}

export interface TransactionImportRunSummary {
  id: string;
  trigger: TransactionImportRunTrigger;
  status: TransactionImportRunStatus;
  gmailAccountIds: string[];
  sources: TransactionImportSource[];
  startDate: string | null;
  endDate: string | null;
  cursor: Record<string, unknown>;
  counts: {
    discovered: number;
    parsed: number;
    review: number;
    queued: number;
    added: number;
    updated: number;
    duplicate: number;
    failed: number;
  };
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TransactionImportItem {
  runTrigger?: TransactionImportRunTrigger;
  /** Original execution eligibility; saved history and corrections remain available. */
  executionEligible?: boolean;
  correction?: FinancialActivity["correction"];
  /** Latest verified correction for read-only consumers; original import fields remain immutable history. */
  effectiveResult?: { correctionId: string; resolution?: 'kept_actual'; entry?: FinancialCorrectionDraft & { payee?: string }; scheduleId?: string; transactionId?: string };
  preparedEvidence?: FinancialWriteEvidence;
  originalAttemptedAt?: number | null;
  id: string;
  runId: string;
  gmailAccountId: string;
  gmailMessageId: string;
  emailUid: string;
  emailSubject: string;
  internetMessageId: string | null;
  source: TransactionImportSource;
  parserVersion: string;
  externalId: string | null;
  importedId: string | null;
  date: string | null;
  amountCents: number | null;
  currency: string | null;
  payee: string | null;
  notes: string;
  actualAccountId: string | null;
  actualCategoryId: string | null;
  automationMode: TransactionImportExecutionMode;
  automaticSafe: boolean;
  blockingWarnings: unknown[];
  evidence: unknown[];
  financialPlan: FinancialEmailPlan | null;
  planShadow: TransactionImportPlanShadow | null;
  status: TransactionImportItemStatus;
  reconciliationStatus: TransactionImportReconciliationStatus | null;
  attempts: number;
  lastError: string | null;
  confirmedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TransactionImportRunDetail extends TransactionImportRunSummary {
  items: TransactionImportItem[];
}

export interface TransactionImportEmailStatusResponse {
  emailUid: string;
  items: TransactionImportItem[];
  financialEvent?: FinancialEmailPlan | null;
}

export interface TransactionImportConfirmation {
  itemId: string;
  date?: string;
  amountCents?: number;
  payee?: string;
  notes?: string;
  actualAccountId?: string;
  actualCategoryId?: string | null;
}

export interface ActualImportTransaction {
  splits?: ActualFinancialSplit[];
  preparedEvidence?: FinancialWriteEvidence;
  itemId: string;
  importedId: string;
  date: string;
  amountCents: number;
  payee: string;
  notes: string;
  categoryId?: string | null;
}

export interface ActualImportAccountGroup {
  accountId: string;
  transactions: ActualImportTransaction[];
}

export interface ActualTransferScheduleInput {
  /** Managed events may update an explicitly selected or uniquely matched, durably previewed schedule. */
  allowUpdate?: boolean;
  scheduleId?: string;
  expectedScheduleFingerprint?: string;
  preparedEvidence?: FinancialWriteEvidence;
  identityKey: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: string;
  name: string;
  budgetId?: string;
}

export type ActualTransferScheduleMode = "preview" | "create_once" | "recover";

export interface ActualTransferScheduleResult {
  scheduleFingerprint?: string;
  evidence?: FinancialWriteEvidence;
  outcome: "would_create" | "would_update" | "created" | "updated" | "already_scheduled" | "already_recorded" | "needs_review";
  reason: string;
  budgetId: string;
  scheduleId?: string;
  transactionId?: string;
}

export type ActualImportItemOutcome =
  | "would_add"
  | "would_update"
  | "already_present"
  | "added"
  | "updated"
  | "failed";

export interface ActualImportBatchResult {
  budgetId?: string;
  dryRun: boolean;
  groups: Array<{
    accountId: string;
    items: Array<{
      itemId: string;
      importedId: string;
      outcome: ActualImportItemOutcome;
      error: string | null;
      evidence?: FinancialWriteEvidence;
    }>;
  }>;
}
