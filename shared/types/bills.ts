import type {
  ActualBillOccurrence,
  ActualCategory,
  ActualCategoryGroup,
  ActualMetadata,
} from "./actual.ts";
import type { TransactionRecord } from "./transactions.ts";

export type BillType = "expense" | "income" | "bill" | "transfer";
export type BillPaySource = "triage" | "pasted_text" | "extract" | string;
export const FINANCIAL_DOCUMENT_KINDS = [
  "one_time_transaction",
  "utility_statement",
  "credit_card_statement",
  "income",
  "informational",
] as const;
export type FinancialDocumentKind = typeof FINANCIAL_DOCUMENT_KINDS[number];
export const FINANCIAL_OPERATION_KINDS = [
  "create_transaction",
  "create_schedule",
  "create_transfer_schedule",
  "no_write",
  "review",
] as const;
export type FinancialOperationKind = typeof FINANCIAL_OPERATION_KINDS[number];
export type FinancialIntendedOperationKind = Exclude<FinancialOperationKind, "review">;
export const BILL_EVENT_KINDS = [
  "statement_issued",
  "payment_due",
  "payment_scheduled",
  "account_transfer_pending",
  "account_transfer_completed",
  "card_payment_completed",
  "payment_completed",
  "payment_cancelled",
  "purchase",
  "refund",
  "bill_issued",
  "reward",
  "payment_failed",
  "other",
] as const;
export type BillEventKind = typeof BILL_EVENT_KINDS[number];
export const FINANCIAL_SETTLEMENT_KINDS = [
  "statement_credit",
  "bank_deposit",
  "balance_to_bank",
] as const;
export type FinancialSettlementKind = typeof FINANCIAL_SETTLEMENT_KINDS[number];
export const BILL_AMOUNT_KINDS = [
  "statement_balance",
  "minimum_due",
  "total_due",
  "payment_amount",
  "transaction_amount",
  "refund_amount",
  "order_total",
  "subtotal",
  "other",
] as const;
export type BillAmountKind = typeof BILL_AMOUNT_KINDS[number];

export interface BillAmountCandidate {
  kind: BillAmountKind;
  value: number;
  evidence?: string | null;
  confidence?: number | null;
}

export interface BillAmountVerification {
  status: "corrected" | "kept_initial" | "failed";
  source_value_count: number;
  initial_covered_count: number;
  verified_covered_count?: number;
  provider?: string;
  model?: string;
}

export interface BillEventVerification {
  status: "corrected" | "kept_initial" | "failed";
  provider?: string;
  model?: string;
}

export interface BillTargetVerification {
  status: "selected" | "kept_ambiguous" | "failed";
  option_count: number;
  provider?: string;
  model?: string;
}

export interface BillSemanticEnrichment {
  status: "complete" | "failed";
  provider: string;
  model: string;
  reason?: string | null;
}

export interface BillTransactionImportEvidence {
  source: string;
  parserVersion: string;
  executionOwner?: "planner";
  externalId?: string | null;
  importedId?: string | null;
  amountCents: number;
  currency?: string | null;
}

export interface BillCandidate {
  currency?: string | null;
  payee?: string;
  payee_hint?: string;
  payee_id?: string | null;
  amount?: number | null;
  amount_kind?: BillAmountKind | null;
  amount_candidates?: BillAmountCandidate[];
  amount_verification?: BillAmountVerification;
  event_kind?: BillEventKind | null;
  event_confidence?: number | null;
  event_evidence?: string | null;
  event_verification?: BillEventVerification;
  account_last4?: string | null;
  account_last4_evidence?: string | null;
  account_last4_confidence?: number | null;
  target_policy_key?: string | null;
  target_confidence?: number | null;
  target_evidence?: string | null;
  target_verification?: BillTargetVerification;
  semantic_enrichment?: BillSemanticEnrichment;
  transaction_import?: BillTransactionImportEvidence;
  due_date?: string | null;
  type?: BillType | string | null;
  type_verification?: BillEventVerification & { attempted_at?: string; attempts?: number };
  type_confidence?: number | null;
  type_evidence?: string | null;
  /** Verbatim card/account product name from the email, never an Actual identity. */
  account_hint?: string | null;
  account_hint_confidence?: number | null;
  /** Verbatim source account description for a non-card account transfer. */
  from_account_hint?: string | null;
  from_account_hint_confidence?: number | null;
  /** Verbatim destination account description for a non-card account transfer. */
  to_account_hint?: string | null;
  to_account_hint_confidence?: number | null;
  /** How an income or movement settles in the owner's ledger. */
  settlement_kind?: FinancialSettlementKind | null;
  settlement_confidence?: number | null;
  settlement_evidence?: string | null;
  /** Provider-issued transaction/order reference used to converge lifecycle emails. */
  provider_reference?: string | null;
  provider_reference_confidence?: number | null;
  provider_reference_evidence?: string | null;
  notes?: string | null;
  category_id?: string | null;
  account_id?: string | null;
  from_account_id?: string | null;
  to_account_id?: string | null;
  schedule_name?: string | null;
  payee_label?: string;
  account_label?: string;
  category_label?: string;
  from_account_label?: string;
  to_account_label?: string;
  [key: string]: unknown;
}

export interface BillEmailContext {
  from?: unknown;
  fromEmail?: unknown;
  from_address?: unknown;
  from_name?: unknown;
  subject?: unknown;
  body?: unknown;
  snippet?: unknown;
  body_snippet?: unknown;
  preview?: unknown;
  [key: string]: unknown;
}

export type FinancialSenderAuthentication = "pass" | "fail" | "none" | "unavailable";

export interface FinancialEmailSourceIdentity {
  provider?: string | null;
  accountId?: string | null;
  senderAddress?: string | null;
  senderAuthentication?: FinancialSenderAuthentication;
  authenticationEvidence?: string[];
}

export interface FinancialEmailInput {
  email?: BillEmailContext;
  candidate?: BillCandidate | null;
  source?: BillPaySource;
  sourceIdentity?: FinancialEmailSourceIdentity | null;
  providerMessageId?: string | null;
  candidateIdentityHint?: string | number | null;
  actualPreflight?: FinancialActualPreflight | null;
}

export interface FinancialActualPreflight {
  status: "passed" | "failed" | "not_run";
  reasons?: FinancialPlanReasonCode[];
}

export interface FinancialEmailIdentity {
  version: 1;
  status: "resolved" | "missing";
  key: string | null;
}

export type FinancialTargetKind =
  | "account"
  | "payee"
  | "category"
  | "from_account"
  | "to_account"
  | "schedule";
export type FinancialTargetStatus = "resolved" | "unresolved" | "not_applicable";
export type FinancialTargetConfidence = "exact" | "high" | "medium" | "low" | "unknown";

export interface FinancialTargetProvenance {
  source: "persisted_candidate" | "source_adapter" | "actual_metadata" | "actual_history" | "model_ranking" | "deterministic_policy";
  confidence: FinancialTargetConfidence;
  reason: string;
  evidence?: string | null;
}

export interface FinancialTargetCandidate {
  key: string;
  label: string;
  confidence: FinancialTargetConfidence;
  reason: string;
}

export interface FinancialPlanTarget {
  kind: FinancialTargetKind;
  status: FinancialTargetStatus;
  id?: string | null;
  label?: string | null;
  provenance: FinancialTargetProvenance[];
  competingCandidates?: FinancialTargetCandidate[];
}

export interface FinancialPlanTargets {
  account: FinancialPlanTarget;
  payee: FinancialPlanTarget;
  category: FinancialPlanTarget;
  fromAccount: FinancialPlanTarget;
  toAccount: FinancialPlanTarget;
  schedule: FinancialPlanTarget;
}

export const FINANCIAL_PLAN_REASON_CODES = [
  "semantic_event_missing",
  "semantic_event_ambiguous",
  "provider_unavailable",
  "canonical_amount_missing",
  "minimum_due_only",
  "due_date_missing",
  "due_date_invalid",
  "account_target_unresolved",
  "payee_target_unresolved",
  "category_target_unresolved",
  "from_account_target_unresolved",
  "to_account_target_unresolved",
  "schedule_target_unresolved",
  "credit_account_evidence_missing",
  "reconciliation_unavailable",
  "reconciliation_conflict",
  "actual_metadata_unavailable",
  "target_evidence_conflict",
  "target_ranking_unresolved",
  "already_recorded",
  "already_scheduled",
  "sender_authentication_failed",
  "sender_authentication_unavailable",
  "stable_identity_missing",
  "actual_preflight_not_run",
  "blocking_warning",
  "automation_class_observe_only",
  "informational_event",
] as const;
export type FinancialPlanReasonCode = typeof FINANCIAL_PLAN_REASON_CODES[number];

export interface FinancialPlanReason {
  code: FinancialPlanReasonCode;
  message: string;
  field?: string | null;
  blocking: boolean;
}

export interface FinancialEmailClassification {
  documentKind: FinancialDocumentKind;
  eventKind: BillEventKind | null;
  confidence: number | null;
  evidence?: string | null;
  reasons: FinancialPlanReasonCode[];
}

export interface FinancialEmailOperation {
  intended: FinancialIntendedOperationKind | null;
  kind: FinancialOperationKind;
  reasons: FinancialPlanReasonCode[];
}

export type FinancialReconciliationStatus =
  | StatementActualStatusKind
  | "not_checked";

export interface FinancialEmailReconciliation {
  status: FinancialReconciliationStatus;
  disposition?: "none" | "create" | "update_existing" | "no_write" | "review";
  reason?: string | null;
  checkedAt?: string | null;
  evidence?: StatementActualEvidence | null;
}

export type FinancialAutomationGateKind =
  | "semantic"
  | "canonical_amount"
  | "date"
  | "targets"
  | "authenticity"
  | "stable_identity"
  | "warnings"
  | "reconciliation"
  | "actual_preflight"
  | "rollout";
export type FinancialAutomationGateStatus = "pass" | "fail" | "unknown" | "not_applicable";

export interface FinancialAutomationGate {
  gate: FinancialAutomationGateKind;
  status: FinancialAutomationGateStatus;
  reasons: FinancialPlanReasonCode[];
}

export interface FinancialAutomationEligibility {
  eligible: boolean;
  operationClass: FinancialAutomationOperationClass;
  rollout: "observe_only" | "enabled";
  gates: FinancialAutomationGate[];
  reasons: FinancialPlanReasonCode[];
}

export type FinancialAutomationOperationClass =
  | "one_time_expense"
  | "income"
  | "utility_schedule"
  | "transfer_schedule"
  | "no_write"
  | "unsupported";

export interface FinancialEmailPlan {
  version: 1;
  candidateSemanticsVersion?: number;
  targetInferenceVersion?: number;
  transferExecution?: { budgetId: string; attemptedAt?: string };
  identity: FinancialEmailIdentity;
  candidate: BillCandidate;
  classification: FinancialEmailClassification;
  operation: FinancialEmailOperation;
  targets: FinancialPlanTargets;
  reconciliation: FinancialEmailReconciliation;
  reviewReasons: FinancialPlanReason[];
  automation: FinancialAutomationEligibility;
}

export interface FinancialEmailExtractionResponse extends BillCandidate {
  provider: string;
  model: string;
  plan: FinancialEmailPlan;
}

export interface BillPayMetadata {
  accounts?: ActualMetadata["accounts"];
  payees?: ActualMetadata["payees"];
  categories?: Array<ActualCategoryGroup | ActualCategory>;
}

export type StatementActualStatusKind =
  | "already_scheduled"
  | "already_recorded"
  | "needs_review"
  | "not_scheduled"
  | "unavailable";

export interface StatementActualEvidence {
  kind?: string;
  scheduleId?: string;
  transactionId?: string;
  name?: string;
  dueDate?: string;
  amount?: number | null;
  account?: string;
  paid?: boolean;
  type?: string;
  count?: number;
  conflicts?: string[];
  scheduleIds?: string[];
  transactionIds?: string[];
  statementAmount?: number;
  adjustment?: {
    policyId: string;
    kind: "fixed_processing_fee";
    label: string;
    amount: number;
  };
}

export interface StatementActualStatus {
  status: StatementActualStatusKind;
  reason?: string;
  checkedAt?: string | null;
  evidence?: StatementActualEvidence | null;
}

export interface BillsMirrorHealth {
  state: string;
  configured?: boolean | null;
  lastSuccessAt?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  pendingRefreshAt?: string | null;
  refreshStartedAt?: string | null;
}

export interface BillsMirrorPayload {
  bills: ActualBillOccurrence[];
  allSchedules: ActualBillOccurrence[];
  payeeMap: Record<string, string>;
  actualConfigured: boolean;
  actualBudgetUrl: string | null;
  syncHealth?: BillsMirrorHealth;
  billsSyncHealth: BillsMirrorHealth;
}

export interface BillExtractionInput {
  subject?: unknown;
  from?: unknown;
  body?: unknown;
}

export interface BillExtractionRequest {
  model: string;
  systemPrompt: string;
  content: string;
  usagePurpose?: "extraction" | "verification" | "matching";
}

export interface BillExtractionProviderResult {
  fields: BillCandidate;
  usage: Record<string, unknown>;
}

export interface BillExtractionProvider {
  id?: string;
  envVar?: string;
  extract(input: BillExtractionRequest): Promise<BillExtractionProviderResult>;
}

export interface BillMutationResponse {
  success?: boolean;
  message?: string;
  syncPending?: boolean;
  localWriteApplied?: boolean;
  code?: string;
  [key: string]: unknown;
}

export interface CalendarBillsRangeResponse {
  schedules: ActualBillOccurrence[];
  transactions: TransactionRecord[];
  transactionsTruncated: boolean;
  actualBudgetUrl?: string | null;
  syncHealth?: BillsMirrorHealth;
  errors: Array<{ source: "transactions"; message: string }>;
}

export interface ActualMetadataResponse {
  accounts?: ActualMetadata["accounts"];
  payees?: ActualMetadata["payees"];
  payeeMap?: ActualMetadata["payeeMap"];
  categories?: ActualMetadata["categories"];
  schedules?: ActualMetadata["schedules"];
  recentTransactions?: ActualMetadata["recentTransactions"];
  actualBudgetUrl?: string | null;
  syncHealth?: {
    state: string;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
  };
}

export interface ActualConnectionOverrides {
  serverURL: string;
  password?: string | null;
  syncId: string;
}

export interface ActualConnectionResponse {
  success: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface ActualCacheStatusResponse {
  success: true;
  configured: boolean;
  hydrated: boolean;
  actualDataDir: string;
  message?: string;
  [key: string]: unknown;
}

export interface ActualCacheHydrationResponse extends BillMutationResponse {
  hydrated?: boolean;
  billsCount?: number;
  schedulesCount?: number;
  syncHealth?: BillsMirrorHealth | null;
}

export interface BillPaySeedRequest {
  source?: BillPaySource;
  email?: BillEmailContext;
  candidate?: BillCandidate | null;
  emailId?: string | null;
  accountId?: string | null;
  subject?: unknown;
  from?: unknown;
  body?: unknown;
  snippet?: unknown;
}
