import { TODOIST_DEADLINE_COLOR } from "../../shared/deadline-source-colors.ts";

const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";

const SOURCE_COLORS = {
  google_calendar: "#4285f4",
  deadline: TODOIST_DEADLINE_COLOR,
  bills: "#22c55e",
};

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function wordStartsWith(text, query) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .some((word) => word.startsWith(query));
}

function dateKeyFromMs(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function dateSortMs(dateKey) {
  const parsed = Date.parse(`${dateKey || ""}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function classifyMatch(candidate, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  const primaryFields = candidate.matchFields?.primary || [];
  const secondaryFields = candidate.matchFields?.secondary || [];
  if (primaryFields.some((field) => normalizeText(field) === normalizedQuery)) {
    return { reason: "exact", bucket: 0 };
  }
  if (primaryFields.some((field) => wordStartsWith(field, normalizedQuery))) {
    return { reason: "word_start", bucket: 1 };
  }
  const searchable = [...primaryFields, ...secondaryFields];
  if (searchable.some((field) => normalizeText(field).includes(normalizedQuery))) {
    return { reason: "field", bucket: 2 };
  }
  return null;
}

function compareTimelineResults(a, b) {
  const aMs = dateSortMs(a.itemDate);
  const bMs = dateSortMs(b.itemDate);
  if (aMs !== bMs) return aMs - bMs;
  if (a.rankBucket !== b.rankBucket) return a.rankBucket - b.rankBucket;

  const titleSort = a.title.localeCompare(b.title);
  if (titleSort !== 0) return titleSort;
  return a.id.localeCompare(b.id);
}

function compareCenteredResults(a, b, centerMs) {
  const aMs = dateSortMs(a.itemDate);
  const bMs = dateSortMs(b.itemDate);
  const aDistance = Math.abs(aMs - centerMs);
  const bDistance = Math.abs(bMs - centerMs);
  if (aDistance !== bDistance) return aDistance - bDistance;
  const aFuture = aMs >= centerMs;
  const bFuture = bMs >= centerMs;
  if (aFuture !== bFuture) return aFuture ? -1 : 1;
  return compareTimelineResults(a, b);
}

function candidateDedupeKey(result) {
  if (!result) return null;
  const title = normalizeText(result.title);
  if (result.type === "event") {
    const payload = result.payload || {};
    return [
      "event",
      payload.accountId || result.activation?.accountId || "",
      payload.calendarId || result.activation?.calendarId || "",
      result.itemDate || "",
      payload.startMs || "",
      payload.endMs || "",
      title,
    ].join("|");
  }
  if (result.type === "deadline") {
    return [
      "deadline",
      result.payload?.id || result.activation?.deadlineId || result.itemId || "",
      result.itemDate || "",
    ].join("|");
  }
  if (result.type === "bill") {
    return [
      "bill",
      result.payload?.scheduleId || result.activation?.scheduleId || result.itemId || "",
      result.itemDate || "",
    ].join("|");
  }
  return [
    result.type || "result",
    result.itemId || result.id || "",
    result.itemDate || "",
    title,
  ].join("|");
}

function eventDedupeBaseKey(result) {
  if (!result || result.type !== "event") return null;
  const payload = result.payload || {};
  return [
    "event",
    payload.accountId || result.activation?.accountId || "",
    payload.calendarId || result.activation?.calendarId || "",
    result.itemDate || "",
    normalizeText(result.title),
  ].join("|");
}

function eventTimeRange(result) {
  const payload = result?.payload || {};
  const startMs = Number(payload.startMs);
  const rawEndMs = Number(payload.endMs);
  if (!Number.isFinite(startMs)) return null;
  const endMs = Number.isFinite(rawEndMs) && rawEndMs > startMs ? rawEndMs : startMs;
  return { startMs, endMs };
}

function eventRangesOverlap(left, right) {
  const a = eventTimeRange(left);
  const b = eventTimeRange(right);
  if (!a || !b) return false;
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function isDuplicateEventResult(result, acceptedResults) {
  const baseKey = eventDedupeBaseKey(result);
  if (!baseKey) return false;
  return acceptedResults.some((accepted) => (
    eventDedupeBaseKey(accepted) === baseKey && eventRangesOverlap(result, accepted)
  ));
}

export function rankCalendarSearchCandidates(candidates, {
  query,
  limit,
  now = new Date(),
} = {}) {
  const centerMs = dateSortMs(dateKeyFromMs(now.getTime()));
  const matched = [];
  const seen = new Set();
  const acceptedEventResults = [];
  for (const candidate of candidates) {
    const match = classifyMatch(candidate, query);
    if (!match) continue;
    const { matchFields: _matchFields, ...result } = candidate;
    if (isDuplicateEventResult(result, acceptedEventResults)) continue;
    const dedupeKey = candidateDedupeKey(result);
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);
    if (result.type === "event") acceptedEventResults.push(result);
    matched.push({
      ...result,
      matchReason: match.reason,
      rankBucket: match.bucket,
    });
  }

  const capped = [...matched]
    .sort((a, b) => compareCenteredResults(a, b, centerMs))
    .slice(0, limit)
    .sort(compareTimelineResults);
  return {
    results: capped,
    totalMatches: matched.length,
    truncated: matched.length > capped.length,
  };
}

export function normalizeEventSearchCandidate(event, { coverageKey = "google_calendar" } = {}) {
  const itemDate = dateKeyFromMs(event.startMs);
  const sourceLabel = event.source || event.calendarName || event.accountLabel || "Google Calendar";
  const subtitle = [event.time, event.duration].filter(Boolean).join(" · ");
  const activation = {
    view: "events",
    detailView: "events",
    dateKey: itemDate,
    itemId: event.id,
    eventId: event.id,
    accountId: event.accountId || null,
    calendarId: event.calendarId || null,
    originalStartTime: event.originalStartTime || null,
  };

  return {
    id: `event:${event.accountId || "account"}:${event.calendarId || "calendar"}:${event.id}:${event.originalStartTime || event.startMs || ""}`,
    type: "event",
    itemId: event.id,
    itemDate,
    title: event.title || "(No title)",
    subtitle,
    location: event.location || "",
    meta: sourceLabel,
    sourceLabel,
    sourceColor: event.color || event.sourceColor || SOURCE_COLORS.google_calendar,
    coverageKey,
    activation,
    payload: {
      id: event.id,
      accountId: event.accountId || null,
      calendarId: event.calendarId || null,
      startMs: event.startMs,
      endMs: event.endMs,
      allDay: !!event.allDay,
      originalStartTime: event.originalStartTime || null,
    },
    matchFields: {
      primary: [event.title],
      secondary: [event.location, event.description, subtitle],
    },
  };
}

function deadlineTitle(task) {
  return task.title || task.name || task.summary || "Untitled deadline";
}

function deadlineDate(task) {
  return task.due_date || task.dueDate || task.date || task.itemDate || null;
}

export function normalizeDeadlineSearchCandidate(task) {
  const itemDate = deadlineDate(task);
  const title = deadlineTitle(task);
  const subtitle = [task.course_name || task.course || task.project_name, task.status]
    .filter(Boolean)
    .join(" · ");
  const rawDeadlineId = String(task.id);
  const occurrenceId = `deadline:${rawDeadlineId}:${itemDate || "undated"}`;
  return {
    id: occurrenceId,
    type: "deadline",
    itemId: occurrenceId,
    itemDate,
    title,
    subtitle,
    status: task.status || null,
    meta: "Deadline",
    sourceLabel: "Deadline",
    sourceColor: SOURCE_COLORS.deadline,
    coverageKey: "deadlines",
    activation: {
      view: "events",
      detailKind: "deadline",
      dateKey: itemDate,
      itemId: occurrenceId,
      deadlineId: rawDeadlineId,
    },
    payload: {
      id: rawDeadlineId,
      dueDate: itemDate,
      status: task.status || null,
    },
    matchFields: {
      primary: [title],
      secondary: [
        subtitle,
        "Deadline",
        task.course_name,
        task.course,
        task.project_name,
        task.status,
      ],
    },
  };
}

export function deadlineSearchCandidates(payload = {}) {
  return (payload.upcoming || []).map((task) => normalizeDeadlineSearchCandidate(task));
}

export function normalizeBillSearchCandidate(bill) {
  const title = bill.name || bill.payee || "Unknown bill";
  const itemDate = bill.next_date || bill.occurrenceDate || bill.date || null;
  const amount = Number(bill.amount || 0);
  const subtitle = [
    bill.payee && bill.payee !== title ? bill.payee : null,
    Number.isFinite(amount) && amount > 0 ? `$${amount.toFixed(2)}` : null,
    bill.paid ? "Paid" : "Upcoming",
  ].filter(Boolean).join(" · ");

  return {
    id: `bill:${bill.id}`,
    type: "bill",
    itemId: bill.id,
    itemDate,
    title,
    subtitle,
    meta: "Bills mirror",
    sourceLabel: "Bills",
    sourceColor: SOURCE_COLORS.bills,
    coverageKey: "bills_mirror",
    activation: {
      view: "bills",
      detailView: "bills",
      dateKey: itemDate,
      itemId: bill.id,
      scheduleId: bill.scheduleId || null,
    },
    payload: {
      id: bill.id,
      scheduleId: bill.scheduleId || null,
      nextDate: itemDate,
      paid: !!bill.paid,
    },
    matchFields: {
      primary: [title],
      secondary: [bill.payee, bill.type, subtitle, "Bills"],
    },
  };
}

export function normalizeLimit(value, { defaultLimit = 50, maxLimit = 100 } = {}) {
  if (value === undefined || value === null || value === "") return defaultLimit;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return Math.min(parsed, maxLimit);
}
