import type {
  TransactionImportConfirmation,
  TransactionImportItem,
  TransactionImportSource,
} from "../../../shared/types/transaction-imports";

const SELECTABLE_STATUSES = new Set(["needs_review", "ready"]);

export function isIndividuallyReviewable(item: TransactionImportItem): boolean {
  return SELECTABLE_STATUSES.has(item.status);
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

export function transactionImportSourceLabel(source: TransactionImportSource): string {
  if (source === "amazon") return "Amazon";
  if (source === "paypal") return "PayPal";
  return "Financial email";
}
