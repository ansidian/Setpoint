import { dayBucket, dueDateToMs } from "./redesign-helpers";

function urgentDeadlines(deadlines, now) {
  const out = [];
  for (const deadline of deadlines || []) {
    if (!deadline || deadline.status === "complete") continue;
    const dueAtMs = dueDateToMs(deadline.due_date, deadline.due_time);
    if (!Number.isFinite(dueAtMs)) continue;
    const bucket = dayBucket(dueAtMs, now);
    if (dueAtMs < now || bucket <= 0) {
      out.push({ deadline, dueAtMs, bucket: "overdue-or-today" });
    } else if (bucket <= 2) {
      out.push({ deadline, dueAtMs, bucket: "soon" });
    }
  }
  return out.sort((a, b) => a.dueAtMs - b.dueAtMs);
}

function unpaidBills(bills, now) {
  const out = [];
  for (const bill of bills || []) {
    if (!bill || bill.paid) continue;
    const targetMs = bill.next_date
      ? new Date(`${bill.next_date}T12:00:00Z`).getTime()
      : null;
    const days = Number.isFinite(targetMs) ? dayBucket(targetMs, now) : null;
    if (days == null || days > 5) continue;
    out.push({ bill, days });
  }
  return out.sort((a, b) => a.days - b.days);
}

function actionableEmailCount(emails) {
  let count = 0;
  const accounts = emails?.accounts || [];
  for (const acc of accounts) {
    for (const email of acc.important || []) {
      if (email.triage === "actionable") count += 1;
    }
  }
  return count;
}

function deadlineContextLabel(entry, now) {
  if (entry.bucket === "overdue-or-today") {
    return entry.dueAtMs < now ? "Overdue" : "Due today";
  }
  return "Next deadline";
}

function deadlineTimingLabel(entry) {
  if (entry.bucket === "overdue-or-today") return null;
  if (entry.bucket === "soon") {
    const days = entry.daysUntil;
    if (days <= 1) return "Due tomorrow";
    return `Due in ${days}d`;
  }
  return null;
}

function deadlineSummary(entry, now) {
  const contextLabel = deadlineContextLabel(entry, now);
  const timingLabel = deadlineTimingLabel(entry);
  return {
    kind: "deadline",
    urgency: entry.bucket === "overdue-or-today" ? "high" : "medium",
    contextLabel,
    timingLabel,
    label: timingLabel || contextLabel,
    title: entry.deadline.title || "Deadline",
    sub: entry.deadline.class_name || entry.deadline.source || null,
    count: entry.count,
  };
}

function billSummary(entry) {
  const timingLabel = entry.days <= 0 ? "Due today" : entry.days === 1 ? "Due tomorrow" : `Due in ${entry.days}d`;
  return {
    kind: "bill",
    urgency: entry.days <= 1 ? "high" : "medium",
    contextLabel: "Next bill",
    timingLabel,
    label: timingLabel,
    title: entry.bill.name || entry.bill.payee || "Bill",
    sub: entry.bill.amount != null ? `$${Number(entry.bill.amount).toFixed(2)}` : null,
    count: entry.count,
  };
}

function emailSummary(actionable) {
  const timingLabel = actionable === 1 ? "1 actionable" : `${actionable} actionable`;
  return {
    kind: "email",
    urgency: actionable >= 5 ? "medium" : "low",
    contextLabel: "Inbox",
    timingLabel,
    label: timingLabel,
    title: actionable === 1 ? "Reply to 1 message" : `Reply to ${actionable} messages`,
    sub: null,
    count: actionable,
  };
}

export function deriveOpenDaySummary({ deadlines = [], bills = [], emails = null, now = Date.now() }) {
  const dl = urgentDeadlines(deadlines, now).map((entry) => ({
    ...entry,
    daysUntil: dayBucket(entry.dueAtMs, now),
  }));
  const bl = unpaidBills(bills, now);
  const actionable = actionableEmailCount(emails);

  const items = [];

  if (dl.length) {
    const top = dl[0];
    items.push(deadlineSummary({ ...top, count: dl.length }, now));
  }

  if (bl.length) {
    const top = bl[0];
    items.push(billSummary({ ...top, count: bl.length }));
  }

  if (actionable > 0) {
    items.push(emailSummary(actionable));
  }

  if (items.length === 0) {
    return {
      tone: "light",
      primary: null,
      secondaries: [],
      hint: "Calendar is open. Best use: clear admin, email, or bills.",
    };
  }

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.urgency] - order[b.urgency]);

  const [primary, ...rest] = items;
  return {
    tone: "pressure",
    primary,
    secondaries: rest,
    hint: null,
  };
}
