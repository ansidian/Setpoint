import type {
  FinancialEmailReconciliation,
  FinancialPlanReasonCode,
  StatementActualEvidence,
} from "../../../../shared/types/bills";
import type { BillResolutionState } from "./readerTypes";

export type ActualResolutionLike = Pick<BillResolutionState, "status"> & Partial<BillResolutionState>;

const ACTIONED_STATUSES = new Set<FinancialEmailReconciliation["status"]>(["already_scheduled", "already_recorded"]);

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
  const statementAmount = evidence?.statementAmount;
  const adjustmentAmount = evidence?.adjustment?.amount;
  if (
    Number.isFinite(Number(amount))
    && Number.isFinite(Number(statementAmount))
    && Number.isFinite(Number(adjustmentAmount))
  ) {
    pieces.push(
      `${currencyFormatter.format(Number(statementAmount))} + ${currencyFormatter.format(Number(adjustmentAmount))} fee = ${currencyFormatter.format(Number(amount))}`,
    );
  } else if (Number.isFinite(Number(amount))) {
    pieces.push(currencyFormatter.format(Number(amount)));
  }
  const date = formatDate(evidence?.dueDate);
  if (date) pieces.push(`${datePrefix} ${date}`);
  return pieces.join(" ");
}

function successDetail(actualStatus: FinancialEmailReconciliation, datePrefix: string): string {
  const summary = evidenceSummary(actualStatus.evidence, datePrefix);
  return summary
    ? `${summary} · No further action needed.`
    : "No further action needed.";
}

function reviewDetail(reason: string | undefined): string {
  if (reason === "transfer_direction_mismatch") {
    return "The transfer accounts or direction in Actual differ from this payment.";
  }
  if (reason === "amount_mismatch") {
    return "The amount in Actual differs from this statement.";
  }
  if (reason === "due_date_mismatch") {
    return "The due date in Actual differs from this statement.";
  }
  return "More than one Actual item could match this statement.";
}

export function isActualActioned(actualStatus: FinancialEmailReconciliation | null | undefined): boolean {
  return actualStatus ? ACTIONED_STATUSES.has(actualStatus.status) : false;
}

export function resolveActualCalendarTarget(
  actualStatus: FinancialEmailReconciliation | null | undefined,
): { date: string; itemId: string } | null {
  if (!actualStatus || !ACTIONED_STATUSES.has(actualStatus.status)) return null;
  const date = actualStatus.evidence?.dueDate;
  const itemId = actualStatus.status === "already_scheduled"
    ? actualStatus.evidence?.scheduleId
    : actualStatus.evidence?.transactionId;
  if (!date || !itemId) return null;
  return { date, itemId };
}

export type ActualActionStatusTone = "success" | "warning" | "neutral" | "checking" | "unavailable";
export interface ActualActionStatusView {
  tone: ActualActionStatusTone;
  title: string;
  detail: string;
}

const SOURCE_DETAIL_LABELS: Partial<Record<FinancialPlanReasonCode, string>> = {
  canonical_amount_missing: "amount",
  due_date_missing: "date",
  due_date_invalid: "valid date",
};

const TARGET_DETAIL_LABELS: Partial<Record<FinancialPlanReasonCode, string>> = {
  account_target_unresolved: "account",
  payee_target_unresolved: "payee",
  category_target_unresolved: "category",
  from_account_target_unresolved: "funding account",
  to_account_target_unresolved: "destination account",
  schedule_target_unresolved: "schedule",
};

function joinDetails(details: string[]): string {
  if (details.length < 3) return details.join(" and ");
  return `${details.slice(0, -1).join(", ")}, and ${details[details.length - 1]}`;
}

function missingDetailsView(resolution: ActualResolutionLike): ActualActionStatusView {
  const reasons = (resolution.plan?.reviewReasons || []).filter((reason) => reason.blocking);
  if (reasons.some((reason) => reason.code === "semantic_event_missing" || reason.code === "semantic_event_ambiguous")) {
    return {
      tone: "neutral",
      title: "Financial activity unclear",
      detail: "We couldn’t tell whether this email describes a bill, transaction, payment, income, or refund.",
    };
  }
  if (reasons.some((reason) => reason.code === "actual_metadata_unavailable")) {
    return {
      tone: "unavailable",
      title: "Couldn’t verify Actual",
      detail: "Actual data is temporarily unavailable.",
    };
  }
  const sourceDetails = [...new Set(reasons.flatMap((reason) => {
    const label = SOURCE_DETAIL_LABELS[reason.code];
    return label ? [label] : [];
  }))];
  const targetDetails = [...new Set(reasons.flatMap((reason) => {
    const label = TARGET_DETAIL_LABELS[reason.code];
    return label ? [label] : [];
  }))];
  // Preserve a distinct blocker ahead of field-level follow-up details.
  const blocker = reasons.find((reason) => (
    !SOURCE_DETAIL_LABELS[reason.code] && !TARGET_DETAIL_LABELS[reason.code]
  ));
  if (!blocker && sourceDetails.length && !targetDetails.length) {
    return {
      tone: "warning",
      title: "Couldn’t read email details",
      detail: `Couldn’t read a clear ${joinDetails(sourceDetails)} from this email.`,
    };
  }
  if (!blocker && targetDetails.length && !sourceDetails.length) {
    return {
      tone: "warning",
      title: "Couldn’t match in Actual",
      detail: `Couldn’t match the ${joinDetails(targetDetails)} in Actual.`,
    };
  }
  if (!blocker && sourceDetails.length && targetDetails.length) {
    return {
      tone: "warning",
      title: "Couldn’t finish checking Actual",
      detail: `Couldn’t read a clear ${joinDetails(sourceDetails)} from this email or match the ${joinDetails(targetDetails)} in Actual.`,
    };
  }
  return {
    tone: "warning",
    title: "Couldn’t finish checking Actual",
    detail: blocker?.message || (resolution.actualStatus?.reason === "insufficient_statement_evidence"
        ? "This email doesn’t include a clear payment date."
        : "We couldn’t match the account or payee in Actual."),
  };
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
  if (actualStatus.reason === "insufficient_reconciliation_identity"
    || actualStatus.reason === "insufficient_statement_evidence") {
    return missingDetailsView(resolution);
  }
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
      detail: reviewDetail(actualStatus.reason || undefined),
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
    detail: actualStatus.reason === "actual_data_not_current"
      ? "Actual data is not current enough for a reliable match."
      : "Actual data is temporarily unavailable.",
  };
}
