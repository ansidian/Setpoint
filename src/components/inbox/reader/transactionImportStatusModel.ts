import { financialHref } from "../../financial/financialNavigation";
import type { TransactionImportItem } from "../../../../shared/types/transaction-imports";

export type TransactionImportStatusItem = Pick<TransactionImportItem, "status" | "automationMode"> & Partial<Pick<TransactionImportItem, "runTrigger" | "financialPlan" | "effectiveResult" | "correction" | "id" | "runId">>;

export type TransactionImportStatusTone = "success" | "warning" | "danger" | "active";

export interface TransactionImportStatusView {
  tone: TransactionImportStatusTone;
  title: string;
  detail: string;
  review: boolean;
  active: boolean;
  recordHref?: string;
}

const ACTIVE = new Set(["queued", "reconciling", "importing"]);

export function hasActiveTransactionImport(items: readonly TransactionImportStatusItem[]): boolean {
  return items.some((item) => (item.runTrigger === "arrival" && ACTIVE.has(item.status)) || (item.correction && !['completed','superseded','attention'].includes(item.correction.state)));
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
  if (corrected && items.every(item => ['added','updated','already_present','dismissed'].includes(item.status))) {
    if (corrected.effectiveResult?.resolution === 'kept_actual') return { tone: 'success', title: 'Current Actual result kept',
      detail: 'You kept the inspected result. No further correction was applied.',
      review: false, active: false, recordHref: recordHref(corrected) };
    return { tone: 'success', title: 'Corrected in Actual',
      detail: corrected.effectiveResult?.entry?.type === 'bill' ? 'The corrected schedule is saved in Actual.' : 'The corrected entry is recorded in Actual.',
      review: false, active: false, recordHref: recordHref(corrected) };
  }
  const arrivals = items.filter(item => item.runTrigger === "arrival");
  const transfer = items.some((item) => item.financialPlan?.operation.intended === "create_transfer_schedule");
  if (transfer) {
    const review = arrivals.find((item) => ["failed", "paused", "needs_review", "ready"].includes(item.status));
    if (review) return {
      tone: "warning", title: "Payment needs review",
      detail: review.financialPlan?.reviewReasons.find((reason) => reason.blocking)?.message || "Check the payment in Actual before making changes.",
      review: true, active: false,
    };
    if (hasActiveTransactionImport(items)) return { tone: "active", title: "Checking payment", detail: "Checking for an existing schedule or recorded transfer in Actual.", review: false, active: true };
    const completed = items.find((item) => ["added", "already_present"].includes(item.status));
    if (completed) return {
      tone: "success", title: completed.financialPlan?.reconciliation.status === "already_recorded" ? "Payment recorded in Actual" : "Payment scheduled in Actual",
      detail: "This payment is already accounted for. Reminders won’t add another record.", review: false, active: false,
    };
  }
  if (arrivals.some((item) => item.status === "failed")) {
    return { tone: "danger", title: "Couldn’t sync", detail: "Open Financial activity to retry this transaction.", review: true, active: false };
  }
  if (arrivals.some((item) => item.status === "paused" || item.status === "needs_review" || item.status === "ready")) {
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
  const saved = items.find(item => item.runTrigger !== "arrival");
  return saved ? { tone: "warning", title: "Saved receipt", detail: "View the saved record and its source evidence.", review: false, active: false, recordHref: recordHref(saved) } : null;
}
