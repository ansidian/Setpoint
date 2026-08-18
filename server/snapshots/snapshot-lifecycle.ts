import type {
  SnapshotBillCandidate,
  SnapshotItem,
  SnapshotLane,
  SnapshotRecord,
  SnapshotStoredLane,
  SnapshotVerificationCode,
  SnapshotWindow,
} from "../../shared/types/snapshots.ts";

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

type SnapshotSource = Record<string, unknown> | null | undefined;

export interface SnapshotItemRow extends Record<string, unknown> {
  id?: string | number | bigint | null;
  snapshot_id?: string | number | bigint | null;
  triage_id?: string | number | bigint | null;
  user_id?: string | null;
  account_id?: string | null;
  email_id?: string | null;
  lane_at_snapshot?: SnapshotStoredLane | null;
  source?: string | null;
  catch_up?: string | number | bigint | null;
  resurfaced_at?: string | number | bigint | null;
  bill_candidate_json?: string | null;
  summary_at_snapshot?: string | null;
  action_at_snapshot?: string | null;
  urgency_at_snapshot?: string | null;
  deadline_at_snapshot?: string | null;
  category_at_snapshot?: string | null;
  escalation_badge_at_snapshot?: string | null;
  subject_at_snapshot?: string | null;
  from_name_at_snapshot?: string | null;
  index_from_name?: string | null;
  from_address_at_snapshot?: string | null;
  index_from_address?: string | null;
  email_date_at_snapshot?: string | null;
  account_label_at_snapshot?: string | null;
  account_email_at_snapshot?: string | null;
  account_color_at_snapshot?: string | null;
  account_icon_at_snapshot?: string | null;
  sort_order?: string | number | bigint | null;
  is_carryover?: string | number | bigint | boolean | null;
  source_at?: string | null;
  dismissed_from_today_at?: string | null;
  handled_at?: string | null;
  provider_removed_at?: string | null;
  read?: string | number | bigint | boolean | null;
  verification_code?: string | null;
  verification_code_kind?: string | null;
  verification_code_active_until?: string | null;
}

function localDateParts(date: Date, timeZone: string): LocalDateParts {
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

function utcDateParts(date: Date): Pick<LocalDateParts, "year" | "month" | "day"> {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedMidnightToUtc(
  { year, month, day }: Pick<LocalDateParts, "year" | "month" | "day">,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMs = timeZoneOffsetMs(guess, timeZone);
  const candidate = new Date(guess.getTime() - offsetMs);
  const adjustedOffsetMs = timeZoneOffsetMs(candidate, timeZone);
  return new Date(guess.getTime() - adjustedOffsetMs);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
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
}: { now?: Date; timeZone?: string } = {}): SnapshotWindow {
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

export function snapshotString(...values: unknown[]): string {
  for (const value of values) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function snapshotDate(snapshot: SnapshotSource): string | null {
  return snapshotString(snapshot?.date, snapshot?.email_date, snapshot?.email_date_at_snapshot) || null;
}

export function normalizeSnapshot(row: unknown): SnapshotRecord | null {
  if (!row) return null;
  const source = row as Record<string, unknown>;
  return {
    ...source,
    id: Number(source.id),
    snapshot_item_id: Number(source.id),
  } as unknown as SnapshotRecord;
}

export function normalizeCount(value: unknown): number {
  return Number(value || 0);
}

export function normalizeBillCandidate(candidate: unknown): SnapshotBillCandidate | null {
  if (!candidate || typeof candidate !== "object") return null;
  const source = candidate as Record<string, unknown>;
  const payee = snapshotString(source.payee, source.payee_hint);
  return {
    ...source,
    payee,
    amount: source.amount ?? source.amount_due ?? null,
    due_date: snapshotString(source.due_date, source.dueDate) || null,
    type: snapshotString(source.type) || "expense",
  };
}

function isVerificationCodeKind(value: unknown): value is SnapshotVerificationCode["kind"] {
  return value === "numeric" || value === "alphanumeric" || value === "hyphenated";
}

export function normalizeSnapshotItem(row: SnapshotItemRow): SnapshotItem {
  const source = row.source || null;
  const resurfacedAt = row.resurfaced_at == null ? null : Number(row.resurfaced_at);
  const catchUp = source === "catch_up" || Number(row.catch_up || 0) === 1;
  const normalizedSource = catchUp ? "catch_up" : source;
  const billCandidate = row.bill_candidate_json
    ? JSON.parse(row.bill_candidate_json) as Record<string, unknown>
    : null;
  const extractedBill = normalizeBillCandidate(billCandidate);
  const verificationKind = row.verification_code_kind;
  const verificationCode = row.verification_code
    && row.verification_code_active_until
    && isVerificationCodeKind(verificationKind)
    ? {
      code: row.verification_code,
      kind: verificationKind,
      active_until: row.verification_code_active_until,
      label: "Verification code" as const,
    }
    : null;
  return {
    id: catchUp ? `catch_up:${Number(row.id)}` : Number(row.id),
    snapshot_id: Number(row.snapshot_id),
    triage_id: Number(row.triage_id),
    user_id: row.user_id || "",
    account_id: row.account_id || "",
    email_id: row.email_id || "",
    uid: row.email_id || "",
    lane: (catchUp ? "catch_up" : row.lane_at_snapshot) as SnapshotLane,
    lane_at_snapshot: row.lane_at_snapshot as SnapshotStoredLane,
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
    verification_code: verificationCode,
  };
}
