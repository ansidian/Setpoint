import { epochFromLa, laComponents } from "../inbox/helpers";
import { addDaysYmd, daysBetweenYmd, parseYmd } from "./calendarDateUtils.js";
import { TODOIST_DEADLINE_COLOR } from "../../../shared/deadline-source-colors";

const TIME_12_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function isValidYmd(value) {
  const parsed = parseYmd(value);
  if (!parsed) return false;
  const date = new Date(Date.UTC(parsed.year, parsed.month, parsed.day, 12));
  return date.toISOString().slice(0, 10) === value;
}

function parseTime24(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function parseDisplayTime(value) {
  const match = String(value || "").match(TIME_12_RE);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function minutesFromDisplayTime(value) {
  const parsed = parseDisplayTime(value);
  return parsed ? parsed.hour * 60 + parsed.minute : null;
}

export function formatTime12FromTime24(value) {
  const parsed = parseTime24(value);
  if (!parsed) return "";
  const ampm = parsed.hour >= 12 ? "PM" : "AM";
  const hour12 = ((parsed.hour + 11) % 12) + 1;
  return `${hour12}:${String(parsed.minute).padStart(2, "0")} ${ampm}`;
}

function formatDisplayTimeFromMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = ((hour + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function ymdToEpoch(value, timeValue = "00:00") {
  const parsedDate = parseYmd(value);
  const parsedTime = parseTime24(timeValue);
  if (!parsedDate || !parsedTime) return null;
  return epochFromLa(parsedDate.year, parsedDate.month, parsedDate.day, parsedTime.hour, parsedTime.minute);
}

function sourceColorFor(editor, draft) {
  const source = editor?.writableCalendars?.find(
    (entry) => entry.value === `${draft?.accountId}::${draft?.calendarId}`,
  );
  return source?.color || "#89b4fa";
}

function eventPlacementKey(input) {
  if (!input) return "";
  return [
    input.accountId || "",
    input.calendarId || "",
    input.allDay ? "all-day" : "timed",
    input.startDate || "",
    input.endDate || "",
    input.allDay ? "" : input.startTime || "",
    input.allDay ? "" : input.endTime || "",
  ].join("|");
}

function eventPlacementKeyFromEvent(event) {
  if (!event?.startMs || !event?.endMs) return "";
  const startDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(event.startMs));
  const endDateRaw = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(event.endMs));
  return eventPlacementKey({
    accountId: event.accountId,
    calendarId: event.calendarId,
    allDay: !!event.allDay,
    startDate,
    endDate: event.allDay ? addDaysYmd(endDateRaw, -1) : endDateRaw,
    startTime: event.allDay ? "" : new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(event.startMs)),
    endTime: event.allDay ? "" : new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(event.endMs)),
  });
}

function normalizeEventDraft({ editor, item, index = 0, batch = false, recurring = false }) {
  const draft = editor?.draft || {};
  const startDate = item?.startDate || draft.startDate;
  const endDate = item?.endDate || item?.startDate || draft.endDate || startDate;
  const allDay = !!draft.allDay;
  if (!isValidYmd(startDate) || !isValidYmd(endDate) || endDate < startDate) return null;

  let startMs = null;
  let endMs = null;
  if (!allDay) {
    const startTime = item?.startTime || draft.startTime;
    const endTime = item?.endTime || draft.endTime;
    if (!parseTime24(startTime) || !parseTime24(endTime)) return null;
    if (`${endDate}T${endTime}` < `${startDate}T${startTime}`) return null;
    startMs = ymdToEpoch(startDate, startTime);
    endMs = ymdToEpoch(endDate, endTime);
  }

  const title = String(item?.title || editor?.effectiveTitle || draft.title || "").trim() || "Untitled";
  return {
    id: batch ? `event-ghost-batch-${index}-${startDate}-${item?.startTime || ""}` : `event-ghost-${index}`,
    kind: "event",
    title,
    startDate,
    endDate,
    allDay,
    startTime: allDay ? null : item?.startTime || draft.startTime,
    endTime: allDay ? null : item?.endTime || draft.endTime,
    startMs,
    endMs,
    color: sourceColorFor(editor, draft),
    accountId: draft.accountId,
    calendarId: draft.calendarId,
    batch,
    recurring,
    recurrenceCue: recurring ? "Repeats" : "",
    lane: index,
    conflictCount: 0,
    conflictTitles: [],
  };
}

function sameEventIdentity(a, b) {
  if (!a || !b) return false;
  if (String(a.id) !== String(b.id)) return false;
  const aOriginal = a.originalStartTime || "";
  const bOriginal = b.originalStartTime || "";
  return aOriginal === bOriginal;
}

function eventConflictCount(ghost, events, editingEvent) {
  const conflicts = [];
  for (const event of events || []) {
    if (!event?.startMs || !event?.endMs) continue;
    if (sameEventIdentity(event, editingEvent)) continue;
    if (ghost.accountId && event.accountId && ghost.accountId !== event.accountId) continue;
    if (ghost.calendarId && event.calendarId && ghost.calendarId !== event.calendarId) continue;

    if (ghost.allDay) {
      if (!event.allDay) continue;
      const eventStart = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(event.startMs));
      const eventEndExclusive = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(event.endMs));
      const eventEnd = addDaysYmd(eventEndExclusive, -1);
      if (ghost.startDate <= eventEnd && ghost.endDate >= eventStart) conflicts.push(event);
      continue;
    }

    if (event.allDay) continue;
    if (ghost.startMs == null || ghost.endMs == null) continue;
    if (ghost.startMs < event.endMs && ghost.endMs > event.startMs) conflicts.push(event);
  }
  return {
    count: conflicts.length,
    titles: conflicts.slice(0, 3).map((event) => event.title || "(No title)"),
  };
}

export function buildEventGhostPreview({ editor, events }) {
  if (!editor?.isEditorOpen) return null;
  const intentMode = editor.intentState?.mode || "single";
  const editingEvent = editor.editingEvent || null;
  let ghosts = [];

  if (!editingEvent && intentMode === "batch") {
    ghosts = (editor.batchDrafts || [])
      .map((item, index) => normalizeEventDraft({ editor, item, index, batch: true }))
      .filter(Boolean);
  } else {
    const ghost = normalizeEventDraft({
      editor,
      item: editor.draft,
      index: 0,
      recurring: intentMode === "recurring" || !!(editingEvent?.isRecurring && editor.recurringEditScope !== "one"),
    });
    if (ghost) ghosts = [ghost];
  }

  if (!ghosts.length) return null;

  if (editingEvent) {
    const originalKey = eventPlacementKeyFromEvent(editingEvent);
    const nextKey = eventPlacementKey(editor.draft);
    if (originalKey === nextKey) return null;
  }

  const withConflicts = ghosts.map((ghost) => {
    const conflict = eventConflictCount(ghost, events, editingEvent);
    return {
      ...ghost,
      conflictCount: conflict.count,
      conflictTitles: conflict.titles,
    };
  });

  return {
    kind: "event",
    ghosts: withConflicts,
    targetDate: withConflicts[0]?.startDate || null,
    totalConflictCount: withConflicts.reduce((sum, ghost) => sum + ghost.conflictCount, 0),
  };
}

const DEADLINE_GHOST_COLOR = TODOIST_DEADLINE_COLOR;

export function deadlinePreviewFromEpoch(epochMs) {
  if (!Number.isFinite(epochMs)) return null;
  const { year, month, day, hour, minute } = laComponents(epochMs);
  return {
    dueDate: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    dueTime: formatDisplayTimeFromMinutes(hour * 60 + minute),
    dueMinutes: hour * 60 + minute,
  };
}

export function buildDeadlineGhostPreview({ draft, dateItems }) {
  if (!draft?.dueDate || !isValidYmd(draft.dueDate)) return null;
  if (draft.isEditing && !draft.placementChanged) return null;
  const activeCount = dateItems?.activeCount ?? dateItems?.items?.length ?? 0;
  const ghost = {
    id: "deadline-ghost",
    kind: "deadline",
    title: String(draft.title || "").trim() || "Untitled",
    startDate: draft.dueDate,
    endDate: draft.dueDate,
    dueTime: draft.dueTime || null,
    dueMinutes: minutesFromDisplayTime(draft.dueTime),
    color: draft.color || DEADLINE_GHOST_COLOR,
    lane: 0,
    conflictCount: 0,
    crowdedCount: activeCount,
  };
  return {
    kind: "deadline",
    ghosts: [ghost],
    targetDate: ghost.startDate,
    totalConflictCount: 0,
  };
}

export function ghostDisplayRange(ghost) {
  if (!ghost) return "";
  if (ghost.kind === "deadline") {
    return [ghost.startDate, ghost.dueTime || "End of day"].filter(Boolean).join(" · ");
  }
  if (ghost.allDay) {
    return ghost.startDate === ghost.endDate ? `${ghost.startDate} · All day` : `${ghost.startDate} to ${ghost.endDate} · All day`;
  }
  return [
    ghost.startDate === ghost.endDate ? ghost.startDate : `${ghost.startDate} to ${ghost.endDate}`,
    `${formatTime12FromTime24(ghost.startTime)}-${formatTime12FromTime24(ghost.endTime)}`,
  ].filter(Boolean).join(" · ");
}

export function dateOutsideMonth(dateKey, viewYear, viewMonth) {
  const parsed = parseYmd(dateKey);
  return !!parsed && (parsed.year !== viewYear || parsed.month !== viewMonth);
}

export function dateOutsideVisibleGrid(dateKey, viewYear, viewMonth) {
  const parsed = parseYmd(dateKey);
  if (!parsed) return false;
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const rowCount = Math.ceil((firstDay + daysInMonth) / 7);
  const firstVisible = new Date(viewYear, viewMonth, 1 - firstDay);
  const lastVisible = new Date(viewYear, viewMonth, rowCount * 7 - firstDay);
  const candidate = new Date(parsed.year, parsed.month, parsed.day);
  return candidate < firstVisible || candidate > lastVisible;
}

export function monthFromYmd(dateKey) {
  const parsed = parseYmd(dateKey);
  return parsed ? { year: parsed.year, month: parsed.month, day: parsed.day } : null;
}

export function ghostSpanDays(ghost) {
  if (!ghost?.startDate || !ghost?.endDate) return 0;
  return Math.max(0, daysBetweenYmd(ghost.startDate, ghost.endDate));
}
