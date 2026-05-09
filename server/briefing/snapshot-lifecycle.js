export const DEFAULT_TIMEZONE = "America/Los_Angeles";

function localDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    second: Number(parts.second || 0),
  };
}

function utcDateParts(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedMidnightToUtc({ year, month, day }, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMs = timeZoneOffsetMs(guess, timeZone);
  const candidate = new Date(guess.getTime() - offsetMs);
  const adjustedOffsetMs = timeZoneOffsetMs(candidate, timeZone);
  return new Date(guess.getTime() - adjustedOffsetMs);
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = localDateParts(date, timeZone);
  const projectedUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return projectedUtc - date.getTime();
}

export function activeSnapshotWindow({
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  const startLocal = localDateParts(now, timeZone);
  const nextLocal = utcDateParts(new Date(Date.UTC(
    startLocal.year,
    startLocal.month - 1,
    startLocal.day + 1,
  )));
  const start = zonedMidnightToUtc(startLocal, timeZone);
  const end = zonedMidnightToUtc(nextLocal, timeZone);
  return {
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    timezone: timeZone,
  };
}

export function normalizeSnapshot(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    snapshot_item_id: Number(row.id),
  };
}

export function normalizeCount(value) {
  return Number(value || 0);
}

export function normalizeBillCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const payee = candidate.payee || candidate.payee_hint || "";
  return {
    ...candidate,
    payee,
    amount: candidate.amount ?? candidate.amount_due ?? null,
    due_date: candidate.due_date || candidate.dueDate || null,
    type: candidate.type || "expense",
  };
}

export function normalizeSnapshotItem(row) {
  const source = row.source || null;
  const resurfacedAt = row.resurfaced_at == null ? null : Number(row.resurfaced_at);
  const catchUp = source === "catch_up" || Number(row.catch_up || 0) === 1;
  const normalizedSource = catchUp ? "catch_up" : source;
  const billCandidate = row.bill_candidate_json ? JSON.parse(row.bill_candidate_json) : null;
  const extractedBill = normalizeBillCandidate(billCandidate);
  return {
    id: catchUp ? `catch_up:${row.id}` : Number(row.id),
    snapshot_id: Number(row.snapshot_id),
    triage_id: Number(row.triage_id),
    user_id: row.user_id,
    account_id: row.account_id,
    email_id: row.email_id,
    uid: row.email_id,
    lane: catchUp ? "catch_up" : row.lane_at_snapshot,
    lane_at_snapshot: row.lane_at_snapshot,
    summary: row.summary_at_snapshot || "",
    preview: row.summary_at_snapshot || "",
    action: row.action_at_snapshot || "",
    urgency: row.urgency_at_snapshot || "normal",
    deadline_at: row.deadline_at_snapshot || null,
    category: row.category_at_snapshot || "uncategorized",
    escalation_badge: row.escalation_badge_at_snapshot || null,
    subject: row.subject_at_snapshot || "",
    from: row.from_name_at_snapshot || row.index_from_name || row.from_address_at_snapshot || row.index_from_address || "",
    from_name: row.from_name_at_snapshot || row.index_from_name || "",
    from_address: row.from_address_at_snapshot || row.index_from_address || "",
    date: row.email_date_at_snapshot || null,
    email_date: row.email_date_at_snapshot || null,
    account_label: row.account_label_at_snapshot || "",
    account_email: row.account_email_at_snapshot || "",
    account_color: row.account_color_at_snapshot || "#818cf8",
    account_icon: row.account_icon_at_snapshot || "Mail",
    sort_order: Number(row.sort_order || 0),
    is_carryover: Boolean(row.is_carryover),
    source: normalizedSource,
    source_at: row.source_at || null,
    resurfaced_at: resurfacedAt,
    _resurfaced: normalizedSource === "resurfaced_snooze",
    _resurfacedAt: normalizedSource === "resurfaced_snooze" ? resurfacedAt : null,
    dismissed_from_today_at: row.dismissed_from_today_at || null,
    handled_at: row.handled_at || null,
    provider_removed_at: row.provider_removed_at || null,
    read: Boolean(row.read),
    hasBill: Boolean(billCandidate),
    bill_candidate: billCandidate,
    extractedBill,
    _catchUp: catchUp,
    previous_snapshot_item_id: catchUp ? Number(row.id) : null,
  };
}
