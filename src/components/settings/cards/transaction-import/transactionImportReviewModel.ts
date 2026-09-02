import type {
  TransactionImportConfirmation,
  TransactionImportItem,
  TransactionImportRunSummary,
} from "../../../../../shared/types/transaction-imports";
import type {
  TransactionImportMappingSource,
  TransactionImportMode,
  TransactionImportSource,
} from "../../../../../shared/types/transaction-imports";

const SELECTABLE_STATUSES = new Set(["needs_review", "ready"]);

export function isBulkSelectable(item: TransactionImportItem): boolean {
  return item.automaticSafe && SELECTABLE_STATUSES.has(item.status)
    && item.reconciliationStatus !== "already_present";
}

export function isIndividuallyReviewable(item: TransactionImportItem): boolean {
  return SELECTABLE_STATUSES.has(item.status);
}

export function selectedTotal(items: TransactionImportItem[], selected: ReadonlySet<string>): number {
  return items.reduce((total, item) => selected.has(item.id) ? total + (item.amountCents || 0) : total, 0);
}

export function itemToConfirmation(
  item: TransactionImportItem,
  edits: Partial<TransactionImportConfirmation> = {},
): TransactionImportConfirmation {
  return {
    itemId: item.id,
    date: item.date || undefined,
    amountCents: item.amountCents ?? undefined,
    payee: item.payee || undefined,
    notes: item.notes,
    actualAccountId: item.actualAccountId || undefined,
    actualCategoryId: item.actualCategoryId,
    ...edits,
  };
}

export function formatImportAmount(amountCents: number | null): string {
  if (!Number.isSafeInteger(amountCents)) return "Amount unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((amountCents || 0) / 100);
}

export function automaticImportConfirmation(
  source: TransactionImportMappingSource,
  currentMode: TransactionImportMode,
  nextMode: TransactionImportMode,
): string | null {
  if (nextMode !== "automatic" || currentMode === "automatic") return null;
  return `Enable automatic ${source === "amazon" ? "Amazon" : "PayPal"} imports? Eligible messages will write to Actual without another click.`;
}

export function transactionImportSourceLabel(source: TransactionImportSource): string {
  if (source === "amazon") return "Amazon";
  if (source === "paypal") return "PayPal";
  return "Financial email";
}

export function runPhase(run: TransactionImportRunSummary): string {
  if (run.status === "queued") return "Waiting to scan";
  if (run.status === "running") return "Scanning Gmail";
  if (run.status === "retry") return "Retry scheduled";
  if (run.status === "paused") return "Needs attention";
  if (run.status === "failed") return "Scan failed";
  return "Scan complete";
}
