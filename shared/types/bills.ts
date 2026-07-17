import type {
  ActualAccount,
  ActualBillOccurrence,
  ActualCategory,
  ActualCategoryGroup,
  ActualMetadata,
  ActualPayee,
} from "./actual.ts";
import type { TransactionRecord } from "./transactions.ts";

export type BillType = "expense" | "income" | "bill" | "transfer";
export type BillPaySource = "triage" | "pasted_text" | "extract" | string;
export type BillPayMatcherGroup = Array<string | string[]>;
export type BillPayAmountStrategy = "statement_balance" | "minimum_due" | "amount_due" | "model_amount" | "none";
export type BillPayAmountFallback = "blank_if_not_found" | "use_model_amount";

export interface BillCandidate {
  payee?: string;
  payee_hint?: string;
  payee_id?: string | null;
  amount?: number | null;
  due_date?: string | null;
  type?: BillType | string;
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

export interface BillPayTargets {
  payee_id?: string | null;
  payee_label?: string | null;
  account_id?: string | null;
  account_label?: string | null;
  category_id?: string | null;
  category_label?: string | null;
  from_account_id?: string | null;
  from_account_label?: string | null;
  to_account_id?: string | null;
  to_account_label?: string | null;
  schedule_name?: string | null;
  [key: string]: unknown;
}

export interface BillPayBehavior {
  id?: string | null;
  enabled?: boolean;
  type?: BillType | string;
  intent?: Record<string, BillPayMatcherGroup>;
  amountStrategy?: BillPayAmountStrategy | string;
  amountFallback?: BillPayAmountFallback | string;
  targets?: BillPayTargets;
  [key: string]: unknown;
}

export interface BillPayProfile {
  id?: string | null;
  enabled?: boolean;
  identity?: Record<string, BillPayMatcherGroup>;
  behaviors?: BillPayBehavior[];
  [key: string]: unknown;
}

export interface BillPayMappings {
  version: number;
  profiles: BillPayProfile[];
  [key: string]: unknown;
}

export interface BillPayMetadata {
  accounts?: ActualMetadata["accounts"];
  payees?: ActualMetadata["payees"];
  categories?: Array<ActualCategoryGroup | ActualCategory>;
}

export interface BillPayResolveInput {
  mappings?: unknown;
  metadata?: BillPayMetadata;
  source?: BillPaySource;
  email?: BillEmailContext;
  candidate?: BillCandidate | null;
}

export interface BillPayDiagnostic {
  field: string;
  id: unknown;
  message: string;
}

export interface BillPayMappingOutcome {
  status: "matched" | "incomplete_mapping" | "invalid_target" | "identity_only" | "unmapped";
  profileId?: string | null;
  behaviorId?: string | null;
  matchedProfiles?: Array<string | null>;
  amountSource?: string | null;
  reason?: string;
  diagnostics?: BillPayDiagnostic[];
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
}

export interface StatementActualStatus {
  status: StatementActualStatusKind;
  reason?: string;
  checkedAt?: string | null;
  evidence?: StatementActualEvidence | null;
}

export interface BillPayResolution {
  bill: BillCandidate;
  mapping: BillPayMappingOutcome;
  actualStatus?: StatementActualStatus;
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
}

export interface BillExtractionResult extends BillCandidate {
  usage?: unknown;
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

export interface ActualListsResponse {
  accounts?: ActualAccount[];
  payees?: ActualPayee[];
  categories?: ActualCategoryGroup[];
}

export interface BillMutationResponse {
  success?: boolean;
  message?: string;
  syncPending?: boolean;
  localWriteApplied?: boolean;
  code?: string;
  [key: string]: unknown;
}

export interface BillExtractionResponse extends BillCandidate {
  provider: string;
  model: string;
  mapping: BillPayMappingOutcome;
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

export type BillPaySeedRequest = Omit<BillPayResolveInput, "mappings" | "metadata"> & {
  emailId?: string | null;
  accountId?: string | null;
  subject?: unknown;
  from?: unknown;
  body?: unknown;
  snippet?: unknown;
};

export interface BillPaySampleRequest {
  mappings?: BillPayMappings | null;
  email?: BillEmailContext;
  candidate?: BillCandidate | null;
}
