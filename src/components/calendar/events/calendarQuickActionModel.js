// Pure payload + date-math builders for the calendar quick-action flows
// (drag-drop reschedule, clone/duplicate, clipboard paste, color change, delete).
// Extracted from useCalendarQuickActions.js so the DST-safe / Pacific-epoch rules
// are unit-testable in isolation (see calendarQuickActionModel.test.js) and the
// hook stays a thin optimistic-mutation controller. No React, no side effects.
import { googleEventColorForId } from "../../../../shared/calendar-event-colors";
import {
  addDaysYmd,
  daysBetweenYmd,
  pacificTime24,
  pacificYMD,
  parseYmd,
} from "../calendarDateUtils.js";
import { epochFromLa } from "../../inbox/helpers.js";

const DAY_MS = 86400000;
let optimisticCloneCounter = 0;

export function eventSelectionId(event) {
  if (!event) return null;
  if (event.id == null) return null;
  if (event.originalStartTime) return `${event.id}::${event.originalStartTime}`;
  return String(event.id);
}

export function eventBounds(event) {
  if (!event?.startMs) return null;
  const start = pacificYMD(event.startMs);
  const end = event.allDay ? addDaysYmd(pacificYMD(event.endMs), -1) : pacificYMD(event.endMs || event.startMs);
  return { start, end };
}

export function mergeBounds(...boundsList) {
  const bounds = boundsList.filter(Boolean);
  if (!bounds.length) return null;
  let start = bounds[0].start;
  let end = bounds[0].end;
  for (const boundsEntry of bounds.slice(1)) {
    if (boundsEntry.start < start) start = boundsEntry.start;
    if (boundsEntry.end > end) end = boundsEntry.end;
  }
  return { start, end };
}

export function shiftEventByDays(event, deltaDays) {
  return {
    ...event,
    startMs: Number.isFinite(event.startMs) ? event.startMs + deltaDays * DAY_MS : event.startMs,
    endMs: Number.isFinite(event.endMs) ? event.endMs + deltaDays * DAY_MS : event.endMs,
  };
}

function optimisticCloneId(event) {
  optimisticCloneCounter += 1;
  return `optimistic-calendar-copy-${event?.id || "event"}-${Date.now()}-${optimisticCloneCounter}`;
}

export function isOptimisticCloneEvent(event) {
  return event?._optimisticCalendarClone === true
    || (typeof event?.id === "string" && event.id.startsWith("optimistic-calendar-copy-"));
}

export function buildReschedulePayload(event, deltaDays = 0, scope) {
  // Derive the new dates by calendar-day arithmetic from the source YMD rather
  // than by re-reading pacificYMD of a fixed-ms (event.startMs + deltaDays*DAY_MS)
  // shift. A fixed 86_400_000ms/day shift crosses a DST boundary off by an hour,
  // so a late-evening event dragged across spring-forward lands on the wrong
  // calendar day. This mirrors the DST-safe approach in buildCloneEventPayload.
  const sourceStartDate = pacificYMD(event.startMs);
  const sourceEndDate = event.allDay
    ? addDaysYmd(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs || event.startMs);
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    title: event.title || "",
    allDay: !!event.allDay,
    startDate: addDaysYmd(sourceStartDate, deltaDays),
    endDate: addDaysYmd(sourceEndDate, deltaDays),
    startTime: event.allDay ? null : pacificTime24(event.startMs),
    endTime: event.allDay ? null : pacificTime24(event.endMs || event.startMs),
    location: event.location || "",
    description: event.description || "",
    etag: event.etag,
    scope: event.isRecurring ? scope : undefined,
    recurringEventId: event.isRecurring ? event.recurringEventId : undefined,
    originalStartTime: event.isRecurring ? event.originalStartTime : undefined,
  };
}

export function buildCloneEventPayload(event, targetDate = null) {
  const sourceDate = pacificYMD(event.startMs);
  const startDate = targetDate || sourceDate;
  const sourceEndDate = event.allDay
    ? addDaysYmd(pacificYMD(event.endMs), -1)
    : pacificYMD(event.endMs || event.startMs);
  const endDate = addDaysYmd(startDate, daysBetweenYmd(sourceDate, sourceEndDate));
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    title: event.title || "",
    allDay: !!event.allDay,
    startDate,
    endDate,
    startTime: event.allDay ? null : pacificTime24(event.startMs),
    endTime: event.allDay ? null : pacificTime24(event.endMs || event.startMs),
    location: event.location || "",
    description: event.description || "",
    colorId: event.colorId || event.sourceColorId || undefined,
  };
}

export function buildOptimisticCloneEvent(event, targetDate = null) {
  const sourceDate = pacificYMD(event.startMs);
  const deltaDays = targetDate ? daysBetweenYmd(sourceDate, targetDate) : 0;
  const shiftedEvent = shiftEventByDays(event, deltaDays);
  const colorId = event.colorId || event.sourceColorId || null;
  return {
    ...shiftedEvent,
    id: optimisticCloneId(event),
    etag: null,
    htmlLink: null,
    openUrl: null,
    colorId,
    color: googleEventColorForId(colorId)?.hex || event.color,
    isRecurring: false,
    recurringEventId: null,
    originalStartTime: null,
    recurrence: null,
    passed: false,
    _optimisticCalendarClone: true,
  };
}

function payloadDateTimeMs(date, time, { allDay = false, end = false } = {}) {
  const datePart = allDay && end ? addDaysYmd(date, 1) : date;
  const timePart = allDay ? "00:00" : time || "00:00";
  // Build the optimistic epoch from Pacific wall-clock components so it matches
  // the server (which interprets the same date/time strings in Pacific). The
  // prior `new Date("YYYY-MM-DDTHH:mm:00")` parsed offsetless strings in the
  // browser's local zone, so a non-Pacific session placed the optimistic event
  // hours off until the server result reconciled it.
  const parsedDate = parseYmd(datePart);
  if (!parsedDate) return Date.now();
  const [hourStr, minuteStr] = String(timePart).split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Date.now();
  return epochFromLa(parsedDate.year, parsedDate.month, parsedDate.day, hour, minute);
}

export function buildOptimisticClipboardPasteEvent(item, index = 0) {
  const colorId = item.colorId || null;
  return {
    id: optimisticCloneId({ id: `clipboard-${index}` }),
    title: item.title || "",
    accountId: item.accountId,
    calendarId: item.calendarId,
    startMs: payloadDateTimeMs(item.startDate, item.startTime, { allDay: !!item.allDay }),
    endMs: payloadDateTimeMs(item.endDate || item.startDate, item.endTime, {
      allDay: !!item.allDay,
      end: true,
    }),
    allDay: !!item.allDay,
    location: item.location || "",
    description: item.description || "",
    colorId,
    color: googleEventColorForId(colorId)?.hex || undefined,
    writable: true,
    etag: null,
    htmlLink: null,
    openUrl: null,
    isRecurring: false,
    recurringEventId: null,
    originalStartTime: null,
    recurrence: null,
    passed: false,
    _optimisticCalendarClone: true,
  };
}

export function buildColorUpdatePayload(event, colorId, scope) {
  return {
    // A color change keeps the event on its current days, so deltaDays = 0.
    ...buildReschedulePayload(event, 0, scope),
    colorId,
  };
}

export function buildDeletePayload(event, scope) {
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    etag: event.etag,
    scope: event.isRecurring ? scope : undefined,
    recurringEventId: event.isRecurring ? event.recurringEventId : undefined,
    originalStartTime: event.isRecurring ? event.originalStartTime : undefined,
  };
}
