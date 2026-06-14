// Pure display-ordering for Alfred's surfaced rows. ADR 0006 is cite-by-reference
// (never reshape/recompute values) — reordering and grouping for display is
// presentation only and does not touch the rows' content. No React here so the
// grouping stays unit-testable with an injected `now`.
import { addDaysYmd, pacificYMD, parseYmd } from "../calendar/calendarDateUtils.js";

function toMs(now) {
  const base = now instanceof Date ? now : now != null ? new Date(now) : new Date();
  return base.getTime();
}

function emailTime(item) {
  const t = new Date(item?.email_date).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Newest first; ties keep input order (stable sort).
function byRecencyDesc(a, b) {
  return emailTime(b) - emailTime(a);
}

function isNeedsAttention(item) {
  return item?.metadata?.lane === "needs_attention";
}

// The dot carries two independent signals: attention lane (color) and unread
// (fill vs ring). `read` is an explicit boolean on the cached row; anything but a
// literal `false` is treated as read so a missing flag never raises a false alarm.
export function emailDotState(item) {
  return {
    unread: item?.read === false,
    attention: isNeedsAttention(item),
  };
}

const DAY_MS = 86_400_000;
// Buckets are by elapsed time (not calendar date) so grouping is timezone-stable
// and matches the relative "Nh/Nd ago" label each row already shows. First bucket
// whose `max` the age falls under wins.
const TIME_BUCKETS = [
  { label: "Today", max: DAY_MS },
  { label: "This week", max: 7 * DAY_MS },
  { label: "Earlier", max: Infinity },
];

function bucketIndex(ageMs) {
  return TIME_BUCKETS.findIndex((bucket) => ageMs < bucket.max);
}

// A single group reads as a flat list, so drop its header — section labels only
// earn their keep once there are 2+ groups to distinguish.
function finalize(groups) {
  const nonEmpty = groups.filter((g) => g.items.length);
  if (nonEmpty.length <= 1) {
    return nonEmpty.map((g) => ({ section: null, items: g.items }));
  }
  return nonEmpty;
}

function groupEmail(list, nowMs) {
  const attention = list.filter(isNeedsAttention).sort(byRecencyDesc);
  const rest = list.filter((item) => !isNeedsAttention(item)).sort(byRecencyDesc);

  const buckets = TIME_BUCKETS.map((bucket) => ({
    section: { label: bucket.label, tone: "time" },
    items: [],
  }));
  for (const item of rest) {
    buckets[bucketIndex(nowMs - emailTime(item))].items.push(item);
  }

  return finalize([
    { section: { label: "Needs action", tone: "attention" }, items: attention },
    ...buckets,
  ]);
}

function eventStart(item) {
  const t = Number(item?.startMs);
  return Number.isFinite(t) ? t : 0;
}

// "Today"/"Tomorrow" for the near days, else a weekday date like "Wed, Jun 17".
function eventDayLabel(ymd, todayYmd, tomorrowYmd) {
  if (ymd === todayYmd) return "Today";
  if (ymd === tomorrowYmd) return "Tomorrow";
  const parts = parseYmd(ymd);
  if (!parts) return ymd || "";
  return new Date(parts.year, parts.month, parts.day)
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function groupEvents(list, nowMs) {
  const sorted = list.slice().sort((a, b) => eventStart(a) - eventStart(b));
  const todayYmd = pacificYMD(nowMs);
  const tomorrowYmd = addDaysYmd(todayYmd, 1);
  const byDay = new Map();
  for (const item of sorted) {
    const key = pacificYMD(eventStart(item));
    if (!byDay.has(key)) {
      byDay.set(key, { section: { label: eventDayLabel(key, todayYmd, tomorrowYmd), tone: "time" }, items: [] });
    }
    byDay.get(key).items.push(item);
  }
  return finalize([...byDay.values()]);
}

// The cached deadline row carries `status` ('complete'|'incomplete'), NOT the
// `completed` boolean from the model-facing projection — so read status, but
// prefer an explicit completed flag if a projection-shaped row ever arrives.
export function deadlineDone(item) {
  if (item?.completed != null) return !!item.completed;
  return item?.status === "complete";
}

function ymdOf(value) {
  return typeof value === "string" ? value : "";
}

// Ascending by YYYY-MM-DD string (lexical compare is chronological); missing
// dates sort last.
function byDateAsc(pick) {
  return (a, b) => {
    const da = ymdOf(pick(a));
    const db = ymdOf(pick(b));
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : da > db ? 1 : 0;
  };
}

function groupDeadlines(list, nowMs) {
  const todayYmd = pacificYMD(nowMs);
  const open = list.filter((item) => !deadlineDone(item)).sort(byDateAsc((i) => i.due_date));
  const done = list.filter(deadlineDone).sort(byDateAsc((i) => i.due_date));
  const overdue = [];
  const today = [];
  const upcoming = [];
  for (const item of open) {
    const due = ymdOf(item.due_date);
    if (due && due < todayYmd) overdue.push(item);
    else if (due === todayYmd) today.push(item);
    else upcoming.push(item); // future or undated
  }
  return finalize([
    { section: { label: "Overdue", tone: "attention" }, items: overdue },
    { section: { label: "Today", tone: "time" }, items: today },
    { section: { label: "Upcoming", tone: "time" }, items: upcoming },
    { section: { label: "Done", tone: "done" }, items: done },
  ]);
}

function groupBills(list) {
  const due = list.filter((item) => !item?.paid).sort(byDateAsc((i) => i.next_date));
  const paid = list.filter((item) => !!item?.paid).sort(byDateAsc((i) => i.next_date));
  return finalize([
    { section: { label: "Due", tone: "time" }, items: due },
    { section: { label: "Paid", tone: "paid" }, items: paid },
  ]);
}

function monthLabel(ymd) {
  const parts = parseYmd(ymd);
  if (!parts) return ymd || "";
  return new Date(parts.year, parts.month, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function groupTransactions(list) {
  const sorted = list.slice().sort((a, b) => {
    const da = ymdOf(a.date);
    const db = ymdOf(b.date);
    if (da === db) return 0;
    return da < db ? 1 : -1; // date DESC
  });
  const byMonth = new Map();
  for (const item of sorted) {
    const ymd = ymdOf(item.date);
    const key = ymd.slice(0, 7); // YYYY-MM
    if (!byMonth.has(key)) {
      byMonth.set(key, { section: { label: monthLabel(ymd), tone: "time" }, items: [] });
    }
    byMonth.get(key).items.push(item);
  }
  return finalize([...byMonth.values()]);
}

// Sum of what's still owed — the "Total due" footer. Unpaid only.
export function billsTotalDue(items) {
  return (items || []).reduce(
    (sum, item) => (item?.paid ? sum : sum + (Number(item?.amount) || 0)),
    0,
  );
}

// A YYYY-MM-DD strictly before today's YYYY-MM-DD.
export function isOverdueYmd(ymd, todayYmd) {
  return typeof ymd === "string" && ymd !== "" && typeof todayYmd === "string" && ymd < todayYmd;
}

// Id of the soonest event at or after `now` — the one to emphasize as "next".
export function nextEventId(items, now) {
  const nowMs = toMs(now);
  let bestId = null;
  let bestStart = Infinity;
  for (const item of items || []) {
    const start = eventStart(item);
    if (start >= nowMs && start < bestStart) {
      bestStart = start;
      bestId = item?.id ?? null;
    }
  }
  return bestId;
}

// True once an event has already ended (falls back to start when no end).
export function eventPassed(item, now) {
  const end = Number(item?.endMs);
  const ref = Number.isFinite(end) ? end : eventStart(item);
  return ref > 0 && ref < toMs(now);
}

export function groupAlfredRows(kind, items, now) {
  const list = Array.isArray(items) ? items : [];
  const nowMs = toMs(now);
  switch (kind) {
    case "email": return groupEmail(list, nowMs);
    case "event": return groupEvents(list, nowMs);
    case "deadline": return groupDeadlines(list, nowMs);
    case "bill": return groupBills(list);
    case "transaction": return groupTransactions(list);
    default: return [{ section: null, items: list }];
  }
}
