import type {
  CreateReminderRequest,
  ReminderKind,
  ReminderPayloadSnapshot,
  TimeToLeaveRouteStatus,
} from "../../../../shared/types/reminders";

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

export interface EventReminderScheduleDraft {
  allDay?: boolean;
  startDate?: string;
  startTime?: string;
}

export interface EventReminderLike {
  id?: string | number | null;
  clientId?: string | null;
  offsetMinutes?: number | string | null;
  offset_minutes?: number | string | null;
  status?: string | null;
  sent?: boolean;
  remindAt?: string | null;
  remind_at?: string | null;
  reminder_kind?: ReminderKind;
  arrival_buffer_minutes?: number | null;
  route_duration_seconds?: number | null;
  route_distance_meters?: number | null;
  route_status?: TimeToLeaveRouteStatus | null;
  route_error_code?: string | null;
  payload_snapshot?: ReminderPayloadSnapshot | null;
}

export interface EventReminderDraftCandidate extends EventReminderLike {
  blocked: boolean;
  blockReason?: "duplicate" | "past" | "missing_anchor";
  remindAt?: string;
}

export interface EventReminderSourceEvent {
  id?: string;
  startMs?: number;
  anchorAt?: string | null;
  accountId?: string | null;
  calendarId?: string | null;
  isRecurring?: boolean;
  originalStartTime?: string | null;
  title?: string;
  calendarSummary?: string;
  sourceLabel?: string;
  htmlLink?: string | null;
  url?: string | null;
  color?: string | null;
  sourceColor?: string | null;
  allDay?: boolean;
  location?: string | null;
}

interface ReminderDraftOptions {
  anchorAt: string;
  offsetMinutes: number | string;
  now: Date | string | number;
  existingReminders: EventReminderLike[];
}

export const EVENT_REMINDER_PRESETS = [
  { offsetMinutes: 0, label: "At start" },
  { offsetMinutes: -10, label: "10 min" },
  { offsetMinutes: -30, label: "30 min" },
  { offsetMinutes: -60, label: "1 hour" },
  { offsetMinutes: -1440, label: "1 day" },
];

function zonedDateTimeToUtcIso(
  dateIso: string | null | undefined,
  time: string | null | undefined,
  timeZone = PACIFIC_TIME_ZONE,
) {
  const [year, month, day] = String(dateIso).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    return null;
  }
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guessMs = targetUtcMs;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  for (let index = 0; index < 4; index += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guessMs))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
    const zonedAsUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    );
    const deltaMs = targetUtcMs - zonedAsUtcMs;
    if (deltaMs === 0) break;
    guessMs += deltaMs;
  }

  return new Date(guessMs).toISOString();
}

export function eventAnchorFromDraft(draft: EventReminderScheduleDraft | null | undefined) {
  const time = draft?.allDay ? "00:00" : draft?.startTime || "00:00";
  return zonedDateTimeToUtcIso(draft?.startDate, time);
}

function computeRemindAt(anchorAt: string, offsetMinutes: number | string) {
  return new Date(new Date(anchorAt).getTime() + Number(offsetMinutes) * 60_000).toISOString();
}

function normalizeOffset(reminder: EventReminderLike | null | undefined) {
  return Number(reminder?.offsetMinutes ?? reminder?.offset_minutes);
}

function createDraft({ anchorAt, offsetMinutes, now, existingReminders }: ReminderDraftOptions): EventReminderDraftCandidate {
  const offset = Number(offsetMinutes);
  const remindAt = computeRemindAt(anchorAt, offset);
  if (isDuplicateReminderOffset(existingReminders, offset)) {
    return { offsetMinutes: offset, remindAt, blocked: true, blockReason: "duplicate" };
  }
  if (new Date(remindAt).getTime() <= new Date(now).getTime()) {
    return { offsetMinutes: offset, remindAt, blocked: true, blockReason: "past" };
  }
  return {
    clientId: `reminder-${offset}-${remindAt}`,
    offsetMinutes: offset,
    remindAt,
    status: "pending",
    blocked: false,
  };
}

export function isDuplicateReminderOffset(
  existingReminders: EventReminderLike[] = [],
  offsetMinutes: number | string,
) {
  const offset = Number(offsetMinutes);
  return (existingReminders || []).some((reminder) =>
    reminder.status !== "missed" && normalizeOffset(reminder) === offset
  );
}

export function getEventReminderPresetState({
  draft,
  offsetMinutes,
  now = new Date(),
  existingReminders = [],
}: {
  draft: EventReminderScheduleDraft;
  offsetMinutes: number | string;
  now?: Date | string | number;
  existingReminders?: EventReminderLike[];
}) {
  const anchorAt = eventAnchorFromDraft(draft);
  const offset = Number(offsetMinutes);
  if (!anchorAt || !Number.isFinite(offset)) {
    return { disabled: true, reason: "missing_anchor", remindAt: null };
  }
  const remindAt = computeRemindAt(anchorAt, offset);
  if (isDuplicateReminderOffset(existingReminders, offset)) {
    return { disabled: true, reason: "duplicate", remindAt };
  }
  if (new Date(remindAt).getTime() <= new Date(now).getTime()) {
    return { disabled: true, reason: "past", remindAt };
  }
  return { disabled: false, reason: null, remindAt };
}

export function createEventReminderDraftFromOffset({
  draft,
  offsetMinutes,
  now = new Date(),
  existingReminders = [],
}: {
  draft: EventReminderScheduleDraft;
  offsetMinutes: number | string;
  now?: Date | string | number;
  existingReminders?: EventReminderLike[];
}): EventReminderDraftCandidate {
  const anchorAt = eventAnchorFromDraft(draft);
  if (!anchorAt) return { blocked: true, blockReason: "missing_anchor" };
  return createDraft({ anchorAt, offsetMinutes, now, existingReminders });
}

export function createEventReminderDraftFromCustom({
  draft,
  reminderDate,
  reminderTime,
  now = new Date(),
  existingReminders = [],
}: {
  draft: EventReminderScheduleDraft;
  reminderDate: string;
  reminderTime: string;
  now?: Date | string | number;
  existingReminders?: EventReminderLike[];
}): EventReminderDraftCandidate {
  const anchorAt = eventAnchorFromDraft(draft);
  const customAt = zonedDateTimeToUtcIso(reminderDate, reminderTime);
  if (!anchorAt || !customAt) return { blocked: true, blockReason: "missing_anchor" };
  const offsetMinutes = Math.round((new Date(customAt).getTime() - new Date(anchorAt).getTime()) / 60_000);
  return createDraft({ anchorAt, offsetMinutes, now, existingReminders });
}

export function eventReminderSourceFromEvent(event: EventReminderSourceEvent | null | undefined) {
  const anchorAt = event?.startMs
    ? new Date(event.startMs).toISOString()
    : event?.anchorAt || null;
  return {
    sourceType: "calendar_event" as const,
    sourceAccountId: event?.accountId || null,
    sourceCalendarId: event?.calendarId || null,
    sourceItemId: event?.id,
    sourceOccurrenceId: event?.isRecurring
      ? event?.originalStartTime || anchorAt
      : null,
    anchorKind: "event_start" as const,
    anchorAt,
    payloadSnapshot: {
      title: event?.title || "Calendar event",
      context: event?.calendarSummary || event?.sourceLabel || "Calendar",
      url: event?.htmlLink || event?.url || null,
      color: event?.color || event?.sourceColor || null,
    },
  };
}

export function buildEventReminderCreatePayload({ event, reminder }: {
  event: EventReminderSourceEvent & { id: string; startMs: number };
  reminder: EventReminderLike;
}): CreateReminderRequest {
  return {
    ...eventReminderSourceFromEvent(event),
    offsetMinutes: normalizeOffset(reminder),
  } as CreateReminderRequest;
}

export function buildTimeToLeaveReminderCreatePayload({ event, reminder }: {
  event: EventReminderSourceEvent & { id: string; startMs: number };
  reminder: EventReminderLike;
}): CreateReminderRequest {
  const source = eventReminderSourceFromEvent(event);
  return {
    reminderKind: "time_to_leave",
    sourceType: "calendar_event",
    sourceAccountId: source.sourceAccountId,
    sourceCalendarId: source.sourceCalendarId,
    sourceItemId: event.id,
    sourceOccurrenceId: source.sourceOccurrenceId,
    eventStart: source.anchorAt!,
    eventLocation: String(event.location || "").trim(),
    isAllDay: !!event.allDay,
    isRecurring: !!event.isRecurring,
    arrivalBufferMinutes: Number(reminder.arrival_buffer_minutes ?? 15),
    payloadSnapshot: {
      ...source.payloadSnapshot,
      location: String(event.location || "").trim(),
    },
  };
}

const URL_ONLY_RE = /^(?:(?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/i;
const ZOOM_ONLY_RE = /^(?:zoom(?: meeting| call| video conference)?|join zoom)$/i;

export function isPhysicalCalendarLocation(value: unknown) {
  const location = String(value || "").trim();
  return !!location && !URL_ONLY_RE.test(location) && !ZOOM_ONLY_RE.test(location);
}

export function projectTimeToLeaveEligibility({
  draft,
  contextAllowed = true,
  now = new Date(),
}: {
  draft: EventReminderScheduleDraft & { location?: string | null };
  contextAllowed?: boolean;
  now?: Date | string | number;
}) {
  if (!contextAllowed) return { eligible: false, reason: "occurrence_only" as const };
  if (draft.allDay) return { eligible: false, reason: "timed_only" as const };
  const anchorAt = eventAnchorFromDraft(draft);
  if (!anchorAt || new Date(anchorAt).getTime() <= new Date(now).getTime()) {
    return { eligible: false, reason: "future_only" as const };
  }
  if (!isPhysicalCalendarLocation(draft.location)) {
    return { eligible: false, reason: "physical_location" as const };
  }
  return { eligible: true, reason: null };
}

export function createTimeToLeaveDraft(arrivalBufferMinutes = 15): EventReminderLike {
  return {
    clientId: `time-to-leave-${arrivalBufferMinutes}`,
    reminder_kind: "time_to_leave",
    arrival_buffer_minutes: arrivalBufferMinutes,
    offsetMinutes: 0,
    status: "pending",
  };
}

export function findTimeToLeaveReminder(reminders: EventReminderLike[] | null | undefined) {
  return (reminders || []).find((reminder) => (
    reminder.reminder_kind === "time_to_leave" && reminder.status !== "missed"
  )) || null;
}

function formatClock(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function projectTimeToLeaveDisplay(reminder: EventReminderLike | null | undefined) {
  if (!reminder) return null;
  const durationMinutes = reminder.route_duration_seconds == null
    ? null
    : Math.max(1, Math.round(Number(reminder.route_duration_seconds) / 60));
  return {
    leaveBy: formatClock(reminder.remind_at || reminder.remindAt),
    durationMinutes,
    arrivalBufferMinutes: Number(reminder.arrival_buffer_minutes ?? 15),
    routeStatus: reminder.route_status || null,
    routeErrorCode: reminder.route_error_code || null,
    sent: reminder.status === "sent",
    persisted: !!reminder.id,
  };
}

export function formatEventReminderLabel(reminder: EventReminderLike) {
  const offset = normalizeOffset(reminder);
  const absolute = Math.abs(offset);
  if (absolute === 0) return "At start";
  if (absolute % 1440 === 0) {
    const days = absolute / 1440;
    return `${days} day${days === 1 ? "" : "s"} ${offset < 0 ? "before" : "after"}`;
  }
  if (absolute % 60 === 0) {
    const hours = absolute / 60;
    return `${hours} hour${hours === 1 ? "" : "s"} ${offset < 0 ? "before" : "after"}`;
  }
  return `${absolute} minutes ${offset < 0 ? "before" : "after"}`;
}

export function projectEventReminderChips(reminders: EventReminderLike[] | null | undefined) {
  return (reminders || []).filter((reminder) => reminder.reminder_kind !== "time_to_leave").map((reminder) => ({
    key: reminder.id || reminder.clientId,
    id: reminder.id || null,
    label: formatEventReminderLabel(reminder),
    status: reminder.status || "pending",
    sent: reminder.status === "sent",
    offsetMinutes: normalizeOffset(reminder),
    raw: reminder,
  }));
}

export function isUnsavedReminder(reminder: EventReminderLike | null | undefined) {
  return !reminder?.id && !reminder?.sent && reminder?.status !== "sent";
}
