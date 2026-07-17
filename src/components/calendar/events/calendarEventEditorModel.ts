import { googleEventColorIdForSourceHex } from "../../../../shared/calendar-event-colors";
import type {
  CalendarEventMutationInput,
  CalendarRecurrenceInput,
  CalendarRecurrenceScope,
  GoogleCalendarSource,
} from "../../../../shared/types/calendar";

export interface CalendarEventDraft {
  title: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  accountId: string;
  calendarId: string;
  location: string;
  description: string;
  colorId?: string | number | null;
  sourceColor?: string | null;
  sourceColorId?: string | null;
}

export interface CalendarEditorEvent {
  id?: string;
  startMs: number;
  endMs: number;
  allDay?: boolean;
  title?: string;
  accountId?: string;
  calendarId?: string;
  location?: string;
  description?: string;
  colorId?: string | number | null;
  sourceColor?: string | null;
  sourceColorId?: string | null;
}

export interface CalendarDateBounds { start: string; end: string }

export interface CalendarSourceGroup {
  accountId: string;
  accountLabel?: string;
  calendars?: Array<Omit<Partial<GoogleCalendarSource>, "id"> & { id: string }>;
}

export interface WritableCalendarOption {
  accountId: string;
  accountLabel?: string;
  value: string;
  calendarId: string;
  summary: string;
  label: string;
  color: string;
  defaultEventColorId: string | null;
  primary: boolean;
}

export interface CalendarManualOverrides {
  startDate: boolean;
  endDate: boolean;
  startTime: boolean;
  endTime: boolean;
  location: boolean;
  allDay: boolean;
}

export interface CalendarBatchDraft {
  id?: string;
  title?: string;
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  error?: string | null;
}

export interface CalendarBatchDraftInput {
  id?: string;
  title?: string;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  error?: string | null;
  allDay?: boolean;
}

export interface CalendarRecurrenceDraftInput extends Partial<Omit<CalendarRecurrenceInput, "interval" | "ends">> {
  interval?: number | string;
  ends?: Omit<NonNullable<CalendarRecurrenceInput["ends"]>, "count"> & { count?: number | string };
}

export interface CalendarFailedBatchEntry {
  input: CalendarEventMutationInput;
  message?: string;
}

export interface CalendarRecurrenceDraft extends CalendarRecurrenceInput {
  frequency: string;
  interval: number;
  weekdays: string[];
  ends: NonNullable<CalendarRecurrenceInput["ends"]>;
}

export interface CalendarTitleAssistDraft {
  title?: string;
  allDay?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

export interface CalendarTitleAssist {
  rawTitle: string;
  mode: string;
  cleanTitle: string;
  titleAfterSourceCommit: string;
  titleAfterLocationCommit: string;
  matchedText: string;
  locationQuery: string;
  sourceQuery: string;
  parsedDateTime: CalendarTitleAssistDraft | null;
  singleDraft: CalendarTitleAssistDraft | null;
  batchDrafts: CalendarBatchDraftInput[];
  recurrenceDraft: CalendarRecurrenceInput | null;
  preview: string;
}

export function pacificYMD(ms: number | string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function pacificTime(ms: number | string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function addDaysIso(dateStr: string, delta: number) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function defaultDraft(selectedDate?: string | null): CalendarEventDraft {
  const date = selectedDate || todayYmd();
  return {
    title: "",
    allDay: false,
    startDate: date,
    endDate: date,
    startTime: "09:00",
    endTime: "09:30",
    accountId: "",
    calendarId: "",
    location: "",
    description: "",
    colorId: null,
    sourceColor: null,
    sourceColorId: null,
  };
}

export function draftFromEvent(event: CalendarEditorEvent): CalendarEventDraft {
  const startDate = pacificYMD(event.startMs);
  const endDate = event.allDay
    ? addDaysIso(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs);

  return {
    title: event.title || "",
    allDay: !!event.allDay,
    startDate,
    endDate,
    startTime: event.allDay ? "09:00" : pacificTime(event.startMs),
    endTime: event.allDay ? "09:30" : pacificTime(event.endMs),
    accountId: event.accountId || "",
    calendarId: event.calendarId || "",
    location: event.location || "",
    description: event.description || "",
    colorId: event.colorId || event.sourceColorId || null,
    sourceColor: event.sourceColor || null,
    sourceColorId: event.sourceColorId || null,
  };
}

export function eventBounds(event: CalendarEditorEvent | null | undefined): CalendarDateBounds | null {
  if (!event) return null;
  const start = pacificYMD(event.startMs);
  const end = event.allDay
    ? addDaysIso(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs);
  return { start, end };
}

export function draftBounds(draft: Partial<CalendarEventDraft> | null | undefined): CalendarDateBounds | null {
  if (!draft?.startDate) return null;
  return { start: draft.startDate, end: draft.endDate || draft.startDate };
}

export function mergeBounds(...allBounds: Array<CalendarDateBounds | null | undefined>): CalendarDateBounds | null {
  const bounds = allBounds.filter((entry): entry is CalendarDateBounds => Boolean(entry));
  if (!bounds.length) return null;
  let start = bounds[0]!.start;
  let end = bounds[0]!.end;
  for (const entry of bounds.slice(1)) {
    if (entry.start < start) start = entry.start;
    if (entry.end > end) end = entry.end;
  }
  return { start, end };
}

export function ymdFromView({ viewYear, viewMonth, selectedDay }: {
  viewYear: number;
  viewMonth: number;
  selectedDay?: number | null;
}) {
  if (!selectedDay) return null;
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
}

export function flattenWritableCalendars(sourceGroups: CalendarSourceGroup[] | null | undefined) {
  const flat: WritableCalendarOption[] = [];
  for (const group of sourceGroups || []) {
    for (const calendar of group.calendars || []) {
      if (!calendar.writable) continue;
      flat.push({
        accountId: group.accountId,
        accountLabel: group.accountLabel,
        value: `${group.accountId}::${calendar.id}`,
        calendarId: calendar.id,
        summary: calendar.summary || "Calendar",
        label: calendar.summary || "Calendar",
        color: calendar.backgroundColor || "#4285f4",
        defaultEventColorId: googleEventColorIdForSourceHex(calendar.backgroundColor || "#4285f4"),
        primary: !!calendar.primary,
      });
    }
  }
  return flat;
}

export function inferNoWritableReason(sourceGroups: CalendarSourceGroup[] | null | undefined) {
  for (const group of sourceGroups || []) {
    for (const calendar of group.calendars || []) {
      if (calendar.accessRole === "owner" || calendar.accessRole === "writer") {
        return "calendar_reauth_required";
      }
    }
  }
  return "calendar_no_writable_sources";
}

export function createManualOverrides(): CalendarManualOverrides {
  return {
    startDate: false,
    endDate: false,
    startTime: false,
    endTime: false,
    location: false,
    allDay: false,
  };
}

function buildInactiveTitleAssist(rawTitle: string, cleanTitle: string): CalendarTitleAssist {
  return {
    rawTitle,
    mode: "single",
    cleanTitle,
    titleAfterSourceCommit: rawTitle,
    titleAfterLocationCommit: rawTitle,
    matchedText: "",
    locationQuery: "",
    sourceQuery: "",
    parsedDateTime: null,
    singleDraft: null,
    batchDrafts: [],
    recurrenceDraft: null,
    preview: "",
  };
}

export function coerceEditingTitleAssist(parsedAssist: CalendarTitleAssist, {
  active,
  fallbackTitle,
  isEditingRecurring,
  recurringEditScope,
}: {
  active: boolean;
  fallbackTitle: string;
  isEditingRecurring: boolean;
  recurringEditScope?: CalendarRecurrenceScope | null;
}): CalendarTitleAssist {
  if (!active) {
    return buildInactiveTitleAssist(parsedAssist.rawTitle, fallbackTitle);
  }

  if (isEditingRecurring && recurringEditScope === "one" && !parsedAssist.parsedDateTime && !parsedAssist.locationQuery && !parsedAssist.sourceQuery) {
    return buildInactiveTitleAssist(parsedAssist.rawTitle, parsedAssist.rawTitle);
  }

  if (parsedAssist.mode === "batch") {
    return {
      ...parsedAssist,
      mode: "single",
      batchDrafts: [],
      recurrenceDraft: null,
    };
  }

  if (isEditingRecurring && recurringEditScope === "one" && parsedAssist.mode === "recurring") {
    return {
      ...parsedAssist,
      mode: "single",
      recurrenceDraft: null,
    };
  }

  return parsedAssist;
}

export function parsePositiveInt(value: unknown, fallback = 1) {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : fallback;
}

function createBatchDraftId(item: CalendarBatchDraftInput | null | undefined, index: number) {
  return [
    "batch",
    index,
    item?.startDate || "no-start",
    item?.startTime || "no-start-time",
    item?.endDate || "no-end",
    item?.endTime || "no-end-time",
  ].join(":");
}

function toBatchEditorDraft(
  item: CalendarBatchDraftInput | null | undefined,
  index: number,
  error?: string | null,
): CalendarBatchDraft {
  return {
    id: createBatchDraftId(item, index),
    title: item?.title || "",
    startDate: item?.startDate || "",
    endDate: item?.endDate || item?.startDate || "",
    startTime: item?.startTime || "",
    endTime: item?.endTime || "",
    error: error || null,
  };
}

export function normalizeBatchDrafts(items: CalendarBatchDraftInput[] | null | undefined) {
  return (items || []).map((item, index) => toBatchEditorDraft(item, index));
}

export function normalizeBatchDraftsWithErrors(failedEntries: CalendarFailedBatchEntry[] | null | undefined) {
  return (failedEntries || []).map((entry, index) =>
    toBatchEditorDraft(entry.input, index, entry.message || "Failed to create"),
  );
}

export function normalizeRecurrenceDraft(
  input: CalendarRecurrenceDraftInput | null | undefined,
  draft: Partial<CalendarEventDraft> | null | undefined,
): CalendarRecurrenceDraft {
  const fallbackWeekday = new Date(`${draft?.startDate || todayYmd()}T12:00:00Z`)
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const fallbackCode = {
    Sun: "SU",
    Mon: "MO",
    Tue: "TU",
    Wed: "WE",
    Thu: "TH",
    Fri: "FR",
    Sat: "SA",
  }[fallbackWeekday as "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat"] || "MO";
  const requestedFrequency = input?.frequency;
  const frequency = requestedFrequency && ["daily", "weekly", "monthly", "yearly"].includes(requestedFrequency)
    ? requestedFrequency
    : "weekly";
  const weekdays = Array.isArray(input?.weekdays) && input.weekdays.length
    ? [...new Set(input.weekdays)]
    : frequency === "weekly"
      ? [fallbackCode]
      : [];
  const endsType = input?.ends?.type || "never";
  return {
    frequency,
    interval: parsePositiveInt(input?.interval, 1),
    weekdays,
    ends: endsType === "onDate"
      ? {
          type: "onDate",
          untilDate: input?.ends?.untilDate || draft?.startDate || todayYmd(),
        }
      : endsType === "afterCount"
        ? {
            type: "afterCount",
            count: parsePositiveInt(input?.ends?.count, 1),
          }
        : { type: "never" },
  };
}

export function buildRecurrencePayload(
  recurrenceDraft: CalendarRecurrenceDraftInput | null | undefined,
  draft: Partial<CalendarEventDraft> | null | undefined,
): CalendarRecurrenceInput | null {
  if (!recurrenceDraft) return null;
  const frequency = recurrenceDraft.frequency || "weekly";
  const payload: CalendarRecurrenceInput = {
    frequency,
    interval: parsePositiveInt(recurrenceDraft.interval, 1),
    ends: recurrenceDraft.ends?.type === "onDate"
      ? {
          type: "onDate",
          untilDate: recurrenceDraft.ends.untilDate,
        }
      : recurrenceDraft.ends?.type === "afterCount"
        ? {
            type: "afterCount",
            count: parsePositiveInt(recurrenceDraft.ends.count, 1),
          }
        : { type: "never" },
  };

  if (frequency === "weekly") payload.weekdays = recurrenceDraft.weekdays || [];
  if (frequency === "monthly" || frequency === "yearly") {
    payload.monthDay = Number((draft?.startDate || todayYmd()).slice(-2));
  }
  if (frequency === "yearly") {
    payload.month = Number((draft?.startDate || todayYmd()).slice(5, 7));
  }
  return payload;
}

export function normalizeDraftForDirty({
  draft,
  effectiveTitle,
  titleInput,
  intentMode,
  batchDrafts,
  recurrenceDraft,
  recurringEditScope,
}: {
  draft: Partial<CalendarEventDraft> | null | undefined;
  effectiveTitle?: string | null;
  titleInput?: string | null;
  intentMode?: string | null;
  batchDrafts?: CalendarBatchDraftInput[] | null;
  recurrenceDraft?: CalendarRecurrenceDraftInput | null;
  recurringEditScope?: CalendarRecurrenceScope | null;
}) {
  return JSON.stringify({
    title: String(effectiveTitle || "").trim(),
    titleInput: String(titleInput || "").trim(),
    allDay: !!draft?.allDay,
    startDate: draft?.startDate || "",
    endDate: draft?.endDate || "",
    startTime: draft?.startTime || "",
    endTime: draft?.endTime || "",
    accountId: draft?.accountId || "",
    calendarId: draft?.calendarId || "",
    location: String(draft?.location || "").trim(),
    description: String(draft?.description || "").trim(),
    intentMode: intentMode || "single",
    batchDrafts: (batchDrafts || []).map((item) => ({
      title: String(item?.title || "").trim(),
      startDate: item?.startDate || "",
      endDate: item?.endDate || "",
      startTime: item?.startTime || "",
      endTime: item?.endTime || "",
    })),
    recurrenceDraft: recurrenceDraft || null,
    recurringEditScope: recurringEditScope || null,
  });
}

export function validateSingleDraft({ draft, effectiveTitle }: {
  draft: Partial<CalendarEventDraft>;
  effectiveTitle?: string | null;
}) {
  if (!effectiveTitle) return "Title is required.";
  if (!draft.accountId || !draft.calendarId) return "Choose a writable calendar.";
  if (!draft.startDate || !draft.endDate) return "Start and end dates are required.";
  if (draft.endDate < draft.startDate) return "End date must be on or after the start date.";
  if (draft.allDay) return null;
  if (!draft.startTime || !draft.endTime) return "Start and end times are required.";
  const startIso = `${draft.startDate}T${draft.startTime}:00`;
  const endIso = `${draft.endDate}T${draft.endTime}:00`;
  if (endIso < startIso) return "End time must be on or after start time.";
  return null;
}

export function validateBatchDrafts({ draft, batchDrafts, effectiveTitle, recurrenceDraft = null }: {
  draft: Partial<CalendarEventDraft>;
  batchDrafts: CalendarBatchDraftInput[];
  effectiveTitle?: string | null;
  recurrenceDraft?: CalendarRecurrenceDraftInput | null;
}) {
  // P3-9: a multi-date batch and a recurrence rule are mutually exclusive. A
  // recurrence-then-batch title sequence (e.g. an active recurrence draft that
  // survives a manualRecurrenceOverride while the title resolves to a batch)
  // would otherwise drop the recurrence silently and create one-off events.
  // Block the save so the user must resolve the conflict.
  if (recurrenceDraft) return "Recurrence cannot be combined with a multi-date batch.";
  if (!effectiveTitle) return "Title is required.";
  if (!draft.accountId || !draft.calendarId) return "Choose a writable calendar.";
  if (!batchDrafts.length) return "Add at least one batch event before saving.";

  for (let index = 0; index < batchDrafts.length; index += 1) {
    const item = batchDrafts[index]!;
    if (!item.startDate || !item.endDate) return `Batch event ${index + 1} is missing a date.`;
    if (item.endDate < item.startDate) return `Batch event ${index + 1} ends before it starts.`;
    if (draft.allDay) continue;
    if (!item.startTime || !item.endTime) return `Batch event ${index + 1} is missing a time.`;
    const startIso = `${item.startDate}T${item.startTime}:00`;
    const endIso = `${item.endDate}T${item.endTime}:00`;
    if (endIso < startIso) return `Batch event ${index + 1} ends before it starts.`;
  }

  return null;
}

export function validateRecurrenceDraft({ recurrenceDraft, draft }: {
  recurrenceDraft: CalendarRecurrenceDraftInput | null | undefined;
  draft: Partial<CalendarEventDraft> | null | undefined;
}) {
  if (!recurrenceDraft) return "Recurring event setup is missing.";
  if (!Number.isInteger(Number(recurrenceDraft.interval)) || Number(recurrenceDraft.interval) <= 0) {
    return "Recurrence interval must be a positive integer.";
  }
  if (recurrenceDraft.frequency === "weekly" && !(recurrenceDraft.weekdays || []).length) {
    return "Choose at least one weekday for weekly recurrence.";
  }
  if (recurrenceDraft.ends?.type === "onDate") {
    if (!recurrenceDraft.ends.untilDate) return "Choose when this recurring event should stop.";
    if (draft?.startDate && recurrenceDraft.ends.untilDate < draft.startDate) {
      return "Recurrence end date must be on or after the event start date.";
    }
  }
  if (recurrenceDraft.ends?.type === "afterCount") {
    if (!Number.isInteger(Number(recurrenceDraft.ends.count)) || Number(recurrenceDraft.ends.count) <= 0) {
      return "Recurrence count must be a positive integer.";
    }
  }
  return null;
}
