import { financialHref } from "../../financial/financialNavigation";
import type { TransactionImportItem } from "../../../../shared/types/transaction-imports";

export type TransactionImportStatusItem = Pick<TransactionImportItem, "status" | "automationMode"> & Partial<Pick<TransactionImportItem, "financialPlan" | "effectiveResult" | "correction" | "id" | "runId">>;

export type TransactionImportStatusTone = "success" | "warning" | "danger" | "active";

export interface TransactionImportStatusView {
  tone: TransactionImportStatusTone;
  title: string;
  detail: string;
  review: boolean;
  active: boolean;
  recordHref?: string;
}

/** Retired import originals are saved history; only an unfinished correction can still progress. */
export function hasActiveTransactionImport(items: readonly TransactionImportStatusItem[]): boolean {
  return items.some((item) => item.correction && !['completed','superseded','attention'].includes(item.correction.state));
}

export function resolveTransactionImportStatus(items: readonly TransactionImportStatusItem[]): TransactionImportStatusView | null {
  if (!items.length) return null;
  const correcting = items.find(item => item.correction && !['completed','superseded'].includes(item.correction.state));
  const correction = correcting?.correction;
  const recordHref = (item: TransactionImportStatusItem) => item.id && item.runId
    ? financialHref({ view: item.correction?.state === 'completed' ? 'completed' : 'needs_attention' }, { owner: 'import', id: item.id, runId: item.runId }) : undefined;
  if (correction) return {
    tone: correction.state === 'attention' ? 'warning' : 'active',
    title: correction.state === 'attention' ? 'Correction needs attention' : 'Checking correction progress',
    detail: 'The correction is retained. Open its record to inspect the current outcome; do not repeat the original import.',
    review: correction.state === 'attention', active: correction.state !== 'attention', recordHref: recordHref(correcting!),
  };
  const corrected = items.find(item => item.effectiveResult);
  if (corrected) {
    if (corrected.effectiveResult?.resolution === 'kept_actual') return { tone: 'success', title: 'Current Actual result kept',
      detail: 'You kept the inspected result. No further correction was applied.',
      review: false, active: false, recordHref: recordHref(corrected) };
    return { tone: 'success', title: 'Corrected in Actual',
      detail: corrected.effectiveResult?.entry?.type === 'bill' ? 'The corrected schedule is saved in Actual.' : 'The corrected entry is recorded in Actual.',
      review: false, active: false, recordHref: recordHref(corrected) };
  }
  const payment = items.find((item) => item.financialPlan?.operation.intended === "create_transfer_schedule" && ["added", "already_present"].includes(item.status));
  if (payment) return {
    tone: "success", title: payment.financialPlan?.reconciliation.status === "already_recorded" ? "Payment recorded in Actual" : "Payment scheduled in Actual",
    detail: "This payment is already accounted for. Reminders won’t add another record.", review: false, active: false,
  };
  if (items.some((item) => item.status === "updated")) {
    return { tone: "success", title: "Updated in Actual", detail: "Actual reconciled this receipt with an existing transaction.", review: false, active: false };
  }
  if (items.some((item) => item.status === "added")) {
    return { tone: "success", title: "Added to Actual", detail: "This receipt is recorded with its stable import ID.", review: false, active: false };
  }
  if (items.some((item) => item.status === "already_present")) {
    return { tone: "success", title: "Already in Actual", detail: "No duplicate transaction was created.", review: false, active: false };
  }
  const saved = items[0]!;
  return { tone: "warning", title: "Saved receipt", detail: "View the saved record and its source evidence.", review: false, active: false, recordHref: recordHref(saved) };
}
