const ACTIONED_STATUSES = new Set(["already_scheduled", "already_recorded"]);

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

function evidenceSummary(evidence, datePrefix) {
  const pieces = [];
  if (Number.isFinite(Number(evidence?.amount))) {
    pieces.push(currencyFormatter.format(Number(evidence.amount)));
  }
  const date = formatDate(evidence?.dueDate);
  if (date) pieces.push(`${datePrefix} ${date}`);
  return pieces.join(" ");
}

function successDetail(actualStatus, datePrefix) {
  const summary = evidenceSummary(actualStatus.evidence, datePrefix);
  return summary
    ? `${summary} · No further action needed.`
    : "No further action needed.";
}

function reviewDetail(reason) {
  if (reason === "amount_mismatch") {
    return "The amount in Actual differs from this statement.";
  }
  if (reason === "due_date_mismatch") {
    return "The due date in Actual differs from this statement.";
  }
  return "More than one Actual item could match this statement.";
}

export function isActualActioned(actualStatus) {
  return ACTIONED_STATUSES.has(actualStatus?.status);
}

export function resolveActualActionStatusView(resolution) {
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
