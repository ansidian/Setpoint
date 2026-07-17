import { dayBucket, dueDateToMs } from "./shell-helpers";

interface OpenDayDeadline {
  title?: string | null;
  class_name?: string | null;
  source?: string | null;
  due_date?: string | null;
  due_time?: unknown;
  status?: string | null;
  [key: string]: unknown;
}

interface OpenDayBill {
  name?: string | null;
  payee?: string | null;
  amount?: unknown;
  next_date?: string | null;
  paid?: unknown;
  [key: string]: unknown;
}

interface OpenDayEmails {
  accounts?: Array<{
    important?: Array<{ triage?: string | null; [key: string]: unknown }>;
  }>;
}

type OpenDayUrgency = "high" | "medium" | "low";

interface OpenDaySummaryItem {
  kind: "deadline" | "bill" | "email";
  urgency: OpenDayUrgency;
  contextLabel: string;
  timingLabel: string | null;
  label: string;
  title: string;
  sub: string | null;
  count: number;
}

interface UrgentDeadlineEntry {
  deadline: OpenDayDeadline;
  dueAtMs: number;
  bucket: "overdue-or-today" | "soon";
}

interface UnpaidBillEntry {
  bill: OpenDayBill;
  days: number;
}

function urgentDeadlines(deadlines: readonly OpenDayDeadline[], now: number): UrgentDeadlineEntry[] {
  const out: UrgentDeadlineEntry[] = [];
  for (const deadline of deadlines || []) {
    if (!deadline || deadline.status === "complete") continue;
    const dueAtMs = dueDateToMs(deadline.due_date, deadline.due_time);
    if (dueAtMs === null || !Number.isFinite(dueAtMs)) continue;
    const bucket = dayBucket(dueAtMs, now);
    if (dueAtMs < now || bucket <= 0) {
      out.push({ deadline, dueAtMs, bucket: "overdue-or-today" });
    } else if (bucket <= 2) {
      out.push({ deadline, dueAtMs, bucket: "soon" });
    }
  }
  return out.sort((a, b) => a.dueAtMs - b.dueAtMs);
}

function unpaidBills(bills: readonly OpenDayBill[], now: number): UnpaidBillEntry[] {
  const out: UnpaidBillEntry[] = [];
  for (const bill of bills || []) {
    if (!bill || bill.paid) continue;
    const targetMs = bill.next_date
      ? new Date(`${bill.next_date}T12:00:00Z`).getTime()
      : null;
    const days = targetMs !== null && Number.isFinite(targetMs) ? dayBucket(targetMs, now) : null;
    if (days == null || days > 5) continue;
    out.push({ bill, days });
  }
  return out.sort((a, b) => a.days - b.days);
}

function actionableEmailCount(emails: OpenDayEmails | null): number {
  let count = 0;
  const accounts = emails?.accounts || [];
  for (const acc of accounts) {
    for (const email of acc.important || []) {
      if (email.triage === "actionable") count += 1;
    }
  }
  return count;
}

function deadlineContextLabel(entry: UrgentDeadlineEntry, now: number): string {
  if (entry.bucket === "overdue-or-today") {
    return entry.dueAtMs < now ? "Overdue" : "Due today";
  }
  return "Next deadline";
}

function deadlineTimingLabel(entry: UrgentDeadlineEntry & { daysUntil: number }): string | null {
  if (entry.bucket === "overdue-or-today") return null;
  if (entry.bucket === "soon") {
    const days = entry.daysUntil;
    if (days <= 1) return "Due tomorrow";
    return `Due in ${days}d`;
  }
  return null;
}

function deadlineSummary(
  entry: UrgentDeadlineEntry & { daysUntil: number; count: number },
  now: number,
): OpenDaySummaryItem {
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

function billSummary(entry: UnpaidBillEntry & { count: number }): OpenDaySummaryItem {
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

function emailSummary(actionable: number): OpenDaySummaryItem {
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

export function deriveOpenDaySummary({
  deadlines = [],
  bills = [],
  emails = null,
  now = Date.now(),
}: {
  deadlines?: OpenDayDeadline[];
  bills?: OpenDayBill[];
  emails?: OpenDayEmails | null;
  now?: number;
}) {
  const dl = urgentDeadlines(deadlines, now).map((entry) => ({
    ...entry,
    daysUntil: dayBucket(entry.dueAtMs, now),
  }));
  const bl = unpaidBills(bills, now);
  const actionable = actionableEmailCount(emails);

  const items: OpenDaySummaryItem[] = [];

  if (dl.length) {
    const top = dl[0]!;
    items.push(deadlineSummary({ ...top, count: dl.length }, now));
  }

  if (bl.length) {
    const top = bl[0]!;
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

  const order: Record<OpenDayUrgency, number> = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.urgency] - order[b.urgency]);

  const [primary, ...rest] = items;
  return {
    tone: "pressure",
    primary,
    secondaries: rest,
    hint: null,
  };
}
