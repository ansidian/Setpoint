export const TRANSACTION_IMPORT_SOURCES = ["amazon", "paypal"] as const;
export type TransactionImportSource = typeof TRANSACTION_IMPORT_SOURCES[number];

export const TRANSACTION_IMPORT_MODES = ["off", "observe", "automatic"] as const;
export type TransactionImportMode = typeof TRANSACTION_IMPORT_MODES[number];

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

export interface TransactionImportMapping {
  source: TransactionImportSource;
  mode: TransactionImportMode;
  actualAccountId: string | null;
  actualCategoryId: string | null;
  createdAt: number;
  updatedAt: number;
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
  automationMode: Exclude<TransactionImportMode, "off">;
  automaticSafe: boolean;
  blockingWarnings: unknown[];
  evidence: unknown[];
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

export interface TransactionImportRunListResponse {
  runs: TransactionImportRunSummary[];
}

export interface TransactionImportEmailStatusResponse {
  emailUid: string;
  items: TransactionImportItem[];
}

export interface TransactionImportMappingUpdate {
  mode: TransactionImportMode;
  actualAccountId: string | null;
  actualCategoryId: string | null;
}

export interface TransactionImportHistoricalScanRequest {
  gmailAccountIds: string[];
  sources: TransactionImportSource[];
  startDate: string;
  endDate: string;
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

export type ActualImportItemOutcome =
  | "would_add"
  | "would_update"
  | "already_present"
  | "added"
  | "updated"
  | "failed";

export interface ActualImportBatchResult {
  dryRun: boolean;
  groups: Array<{
    accountId: string;
    items: Array<{
      itemId: string;
      importedId: string;
      outcome: ActualImportItemOutcome;
      error: string | null;
    }>;
  }>;
}
