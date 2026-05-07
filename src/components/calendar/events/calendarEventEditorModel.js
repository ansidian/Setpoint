import { googleEventColorIdForSourceHex } from "../../../../shared/calendar-event-colors.js";

export function pacificYMD(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function pacificTime(ms) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function addDaysIso(dateStr, delta) {
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

export function defaultDraft(selectedDate) {
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

export function draftFromEvent(event) {
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

export function eventBounds(event) {
  if (!event) return null;
  const start = pacificYMD(event.startMs);
  const end = event.allDay
    ? addDaysIso(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs);
  return { start, end };
}

export function draftBounds(draft) {
  if (!draft?.startDate) return null;
  return { start: draft.startDate, end: draft.endDate || draft.startDate };
}

export function mergeBounds(...allBounds) {
  const bounds = allBounds.filter(Boolean);
  if (!bounds.length) return null;
  let start = bounds[0].start;
  let end = bounds[0].end;
  for (const entry of bounds.slice(1)) {
    if (entry.start < start) start = entry.start;
    if (entry.end > end) end = entry.end;
  }
  return { start, end };
}

export function ymdFromView({ viewYear, viewMonth, selectedDay }) {
  if (!selectedDay) return null;
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
}

export function flattenWritableCalendars(sourceGroups) {
  const flat = [];
  for (const group of sourceGroups || []) {
    for (const calendar of group.calendars || []) {
      if (!calendar.writable) continue;
      flat.push({
        accountId: group.accountId,
        accountLabel: group.accountLabel,
        value: `${group.accountId}::${calendar.id}`,
        calendarId: calendar.id,
        summary: calendar.summary,
        label: calendar.summary,
        color: calendar.backgroundColor || "#4285f4",
        defaultEventColorId: googleEventColorIdForSourceHex(calendar.backgroundColor || "#4285f4"),
        primary: !!calendar.primary,
      });
    }
  }
  return flat;
}

export function inferNoWritableReason(sourceGroups) {
  for (const group of sourceGroups || []) {
    for (const calendar of group.calendars || []) {
      if (calendar.accessRole === "owner" || calendar.accessRole === "writer") {
        return "calendar_reauth_required";
      }
    }
  }
  return "calendar_no_writable_sources";
}

export function createManualOverrides() {
  return {
    startDate: false,
    endDate: false,
    startTime: false,
    endTime: false,
    location: false,
    allDay: false,
  };
}

function buildInactiveTitleAssist(rawTitle, cleanTitle) {
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

export function coerceEditingTitleAssist(parsedAssist, {
  active,
  fallbackTitle,
  isEditingRecurring,
  recurringEditScope,
}) {
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

export function parsePositiveInt(value, fallback = 1) {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : fallback;
}

function createBatchDraftId(item, index) {
  return [
    "batch",
    index,
    item?.startDate || "no-start",
    item?.startTime || "no-start-time",
    item?.endDate || "no-end",
    item?.endTime || "no-end-time",
  ].join(":");
}

function toBatchEditorDraft(item, index, error) {
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

export function normalizeBatchDrafts(items) {
  return (items || []).map((item, index) => toBatchEditorDraft(item, index));
}

export function normalizeBatchDraftsWithErrors(failedEntries) {
  return (failedEntries || []).map((entry, index) =>
    toBatchEditorDraft(entry.input, index, entry.message || "Failed to create"),
  );
}

export function normalizeRecurrenceDraft(input, draft) {
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
  }[fallbackWeekday] || "MO";
  const frequency = ["daily", "weekly", "monthly", "yearly"].includes(input?.frequency)
    ? input.frequency
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

export function buildRecurrencePayload(recurrenceDraft, draft) {
  if (!recurrenceDraft) return null;
  const frequency = recurrenceDraft.frequency;
  const payload = {
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

export function validateSingleDraft({ draft, effectiveTitle }) {
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

export function validateBatchDrafts({ draft, batchDrafts, effectiveTitle }) {
  if (!effectiveTitle) return "Title is required.";
  if (!draft.accountId || !draft.calendarId) return "Choose a writable calendar.";
  if (!batchDrafts.length) return "Add at least one batch event before saving.";

  for (let index = 0; index < batchDrafts.length; index += 1) {
    const item = batchDrafts[index];
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

export function validateRecurrenceDraft({ recurrenceDraft, draft }) {
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
