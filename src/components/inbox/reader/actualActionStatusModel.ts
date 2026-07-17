import type { StatementActualEvidence, StatementActualStatus } from "../../../../shared/types/bills";
import type { BillResolutionState } from "./readerTypes";

export type ActualResolutionLike = Pick<BillResolutionState, "status"> & Partial<BillResolutionState>;

const ACTIONED_STATUSES = new Set<StatementActualStatus["status"]>(["already_scheduled", "already_recorded"]);

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(value: unknown): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

function evidenceSummary(evidence: StatementActualEvidence | null | undefined, datePrefix: string): string {
  const pieces = [];
  const amount = evidence?.amount;
  if (Number.isFinite(Number(amount))) {
    pieces.push(currencyFormatter.format(Number(amount)));
  }
  const date = formatDate(evidence?.dueDate);
  if (date) pieces.push(`${datePrefix} ${date}`);
  return pieces.join(" ");
}

function successDetail(actualStatus: StatementActualStatus, datePrefix: string): string {
  const summary = evidenceSummary(actualStatus.evidence, datePrefix);
  return summary
    ? `${summary} · No further action needed.`
    : "No further action needed.";
}

function reviewDetail(reason: string | undefined): string {
  if (reason === "amount_mismatch") {
    return "The amount in Actual differs from this statement.";
  }
  if (reason === "due_date_mismatch") {
    return "The due date in Actual differs from this statement.";
  }
  return "More than one Actual item could match this statement.";
}

export function isActualActioned(actualStatus: StatementActualStatus | null | undefined): boolean {
  return actualStatus ? ACTIONED_STATUSES.has(actualStatus.status) : false;
}

export function resolveRecordedActualCalendarTarget(
  actualStatus: StatementActualStatus | null | undefined,
): { date: string; itemId: string } | null {
  if (actualStatus?.status !== "already_recorded") return null;
  const date = actualStatus.evidence?.dueDate;
  const itemId = actualStatus.evidence?.transactionId;
  if (!date || !itemId) return null;
  return { date, itemId };
}

export type ActualActionStatusTone = "success" | "warning" | "neutral" | "checking" | "unavailable";
export interface ActualActionStatusView {
  tone: ActualActionStatusTone;
  title: string;
  detail: string;
}

export function resolveActualActionStatusView(
  resolution: ActualResolutionLike | null | undefined,
): ActualActionStatusView | null {
  if (!resolution || resolution.status === "idle") return null;
  if (resolution.status === "loading") {
    return {
      tone: "checking",
      title: "Checking Actual…",
      detail: "Looking for a matching schedule or transaction.",
    };
  }
  if (resolution.status === "error" || !resolution.actualStatus) {
    return {
      tone: "unavailable",
      title: "Couldn’t verify Actual",
      detail: "Actual data is temporarily unavailable.",
    };
  }

  const actualStatus = resolution.actualStatus;
  if (actualStatus.status === "already_scheduled") {
    return {
      tone: "success",
      title: "Already scheduled in Actual",
      detail: successDetail(actualStatus, "due"),
    };
  }
  if (actualStatus.status === "already_recorded") {
    return {
      tone: "success",
      title: "Already recorded in Actual",
      detail: successDetail(actualStatus, "on"),
    };
  }
  if (actualStatus.status === "needs_review") {
    return {
      tone: "warning",
      title: "Actual match needs review",
      detail: reviewDetail(actualStatus.reason),
    };
  }
  if (actualStatus.status === "not_scheduled") {
    return {
      tone: "neutral",
      title: "Not scheduled in Actual",
      detail: "No matching schedule or transaction was found.",
    };
  }
  return {
    tone: "unavailable",
    title: "Couldn’t verify Actual",
    detail: actualStatus.reason === "insufficient_statement_evidence"
      ? "The statement does not include enough detail for a reliable match."
      : "Actual data is not current enough for a reliable match.",
  };
}
