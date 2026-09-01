import type { TransactionImportItem } from "../../../../shared/types/transaction-imports";

export type TransactionImportStatusItem = Pick<TransactionImportItem, "status" | "automationMode">;

export type TransactionImportStatusTone = "success" | "warning" | "danger" | "active";

export interface TransactionImportStatusView {
  tone: TransactionImportStatusTone;
  title: string;
  detail: string;
  review: boolean;
  active: boolean;
}

const ACTIVE = new Set(["queued", "reconciling", "importing"]);

export function hasActiveTransactionImport(items: readonly TransactionImportStatusItem[]): boolean {
  return items.some((item) => ACTIVE.has(item.status));
}

export function resolveTransactionImportStatus(items: readonly TransactionImportStatusItem[]): TransactionImportStatusView | null {
  if (!items.length) return null;
  if (items.some((item) => item.status === "failed")) {
    return { tone: "danger", title: "Couldn’t sync", detail: "Open Finance settings to retry this transaction.", review: true, active: false };
  }
  if (items.some((item) => item.status === "paused" || item.status === "needs_review" || item.status === "ready")) {
    const observed = items.some((item) => item.status === "ready" && item.automationMode === "observe");
    return {
      tone: "warning",
      title: "Needs review",
      detail: observed ? "Observed safely; no Actual write was made." : "Review the proposed transaction before adding it.",
      review: true,
      active: false,
    };
  }
  if (hasActiveTransactionImport(items)) {
    return { tone: "active", title: "Syncing transaction", detail: "Checking this receipt against Actual.", review: false, active: true };
  }
  if (items.some((item) => item.status === "updated")) {
    return { tone: "success", title: "Updated in Actual", detail: "Actual reconciled this receipt with an existing transaction.", review: false, active: false };
  }
  if (items.some((item) => item.status === "added")) {
    return { tone: "success", title: "Added to Actual", detail: "This receipt is recorded with its stable import ID.", review: false, active: false };
  }
  if (items.some((item) => item.status === "already_present")) {
    return { tone: "success", title: "Already in Actual", detail: "No duplicate transaction was created.", review: false, active: false };
  }
  return null;
}
