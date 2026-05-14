import {
  addDaysYmd,
  daysBetweenYmd,
  pacificTime24,
  pacificYMD,
} from "../calendarDateUtils.js";
import { isGoogleSpecialDateEvent } from "../googleSpecialDateModel.js";

function stablePart(value) {
  return String(value ?? "").trim();
}

function hasFiniteMs(value) {
  return Number.isFinite(Number(value));
}

function isExcludedSelectionSource(event) {
  return event?.agendaItemKind === "deadline"
    || event?.kind === "bill"
    || event?.billId != null
    || event?.ghostKind != null
    || event?._calendarGhost === true
    || event?.resultKind === "calendar-search-result"
    || event?.searchResult === true
    || isGoogleSpecialDateEvent(event);
}

function calendarEventOccurrenceKey(event) {
  if (event?.isRecurring || event?.recurringEventId || event?.originalStartTime) {
    return stablePart(event.originalStartTime || event.startMs || event.id);
  }
  return stablePart(event?.id);
}

export function isCalendarEventSelectionEligible(event) {
  return !!(
    event
    && !isExcludedSelectionSource(event)
    && event.writable === true
    && stablePart(event.accountId)
    && stablePart(event.calendarId)
    && stablePart(event.id)
    && hasFiniteMs(event.startMs)
  );
}

export function calendarEventSelectionIdentity(event) {
  if (!isCalendarEventSelectionEligible(event)) return null;
  const seriesOrEventId = stablePart(event.recurringEventId || event.id);
  return [
    stablePart(event.accountId),
    stablePart(event.calendarId),
    seriesOrEventId,
    calendarEventOccurrenceKey(event),
  ].join("::");
}

function normalizeSelection(selection) {
  if (!selection?.items || !Array.isArray(selection.items)) {
    return createCalendarEventSelectionSet();
  }
  const byIdentity = new Map();
  for (const item of selection.items) {
    if (!item?.identity || !item.event) continue;
    byIdentity.set(item.identity, {
      identity: item.identity,
      event: { ...item.event },
    });
  }
  return { items: Array.from(byIdentity.values()) };
}

export function createCalendarEventSelectionSet(events = []) {
  let selection = { items: [] };
  for (const event of events) {
    const identity = calendarEventSelectionIdentity(event);
    if (!identity) continue;
    selection.items.push({ identity, event: { ...event } });
  }
  return normalizeSelection(selection);
}

export function isCalendarEventSelected(selection, event) {
  const identity = calendarEventSelectionIdentity(event);
  if (!identity) return false;
  return normalizeSelection(selection).items.some((item) => item.identity === identity);
}

export function toggleCalendarEventSelection(selection, event) {
  const identity = calendarEventSelectionIdentity(event);
  if (!identity) return normalizeSelection(selection);
  const current = normalizeSelection(selection);
  if (current.items.some((item) => item.identity === identity)) {
    return {
      items: current.items.filter((item) => item.identity !== identity),
    };
  }
  return {
    items: [
      ...current.items,
      { identity, event: { ...event } },
    ],
  };
}

export function addCalendarEventSelection(selection, event) {
  const identity = calendarEventSelectionIdentity(event);
  if (!identity) return normalizeSelection(selection);
  const current = normalizeSelection(selection);
  if (current.items.some((item) => item.identity === identity)) return current;
  return {
    items: [
      ...current.items,
      { identity, event: { ...event } },
    ],
  };
}

export function removeCalendarEventSelection(selection, eventOrIdentity) {
  const identity = typeof eventOrIdentity === "string"
    ? eventOrIdentity
    : calendarEventSelectionIdentity(eventOrIdentity);
  const current = normalizeSelection(selection);
  if (!identity) return current;
  return {
    items: current.items.filter((item) => item.identity !== identity),
  };
}

export function clearCalendarEventSelection() {
  return { items: [] };
}

export function calendarEventSelectionSize(selection) {
  return normalizeSelection(selection).items.length;
}

function selectedEventSortValue(event) {
  return Number.isFinite(Number(event?.startMs)) ? Number(event.startMs) : 0;
}

export function getOrderedCalendarEventSelection(selection) {
  return normalizeSelection(selection).items
    .map((item) => ({ identity: item.identity, event: { ...item.event } }))
    .sort((a, b) => {
      const startDiff = selectedEventSortValue(a.event) - selectedEventSortValue(b.event);
      if (startDiff) return startDiff;
      const aTitle = stablePart(a.event.title).toLocaleLowerCase();
      const bTitle = stablePart(b.event.title).toLocaleLowerCase();
      const titleDiff = aTitle.localeCompare(bTitle);
      if (titleDiff) return titleDiff;
      return a.identity.localeCompare(b.identity);
    })
    .map((item) => item.event);
}

function orderedSelectionEntries(selection) {
  const normalized = normalizeSelection(selection);
  const orderedEvents = getOrderedCalendarEventSelection(normalized);
  return orderedEvents.map((event) => ({
    identity: calendarEventSelectionIdentity(event),
    event,
  })).filter((item) => item.identity);
}

export function resolveCalendarEventActionScope(selection, contextEvent) {
  const contextIdentity = calendarEventSelectionIdentity(contextEvent);
  if (!contextIdentity) {
    return { kind: "none", events: [], identities: [] };
  }

  const orderedEntries = orderedSelectionEntries(selection);
  if (orderedEntries.some((item) => item.identity === contextIdentity)) {
    return {
      kind: "selection",
      events: orderedEntries.map((item) => ({ ...item.event })),
      identities: orderedEntries.map((item) => item.identity),
    };
  }

  return {
    kind: "single",
    events: [{ ...contextEvent }],
    identities: [contextIdentity],
  };
}

function eventsFromClipboardSource(source) {
  if (Array.isArray(source)) {
    return getOrderedCalendarEventSelection(createCalendarEventSelectionSet(source));
  }
  if (isCalendarEventSelectionEligible(source)) {
    return [source];
  }
  return getOrderedCalendarEventSelection(source);
}

function calendarEventDateRange(event) {
  const startDate = pacificYMD(event.startMs);
  const endDate = event.allDay
    ? addDaysYmd(pacificYMD(event.endMs || event.startMs), -1)
    : pacificYMD(event.endMs || event.startMs);
  return { startDate, endDate };
}

function clipboardEventFromCalendarEvent(event) {
  const { startDate, endDate } = calendarEventDateRange(event);
  return {
    sourceIdentity: calendarEventSelectionIdentity(event),
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
    colorId: event.colorId || event.sourceColorId || null,
  };
}

export function createCalendarEventClipboard(source) {
  const events = eventsFromClipboardSource(source)
    .filter(isCalendarEventSelectionEligible)
    .map(clipboardEventFromCalendarEvent);
  if (!events.length) return null;
  return {
    kind: "calendar-event-clipboard",
    version: 1,
    events,
  };
}

function pasteItemFromClipboardEvent(entry, { anchorDate, targetDate }) {
  const startOffsetDays = daysBetweenYmd(anchorDate, entry.startDate);
  const spanDays = daysBetweenYmd(entry.startDate, entry.endDate);
  const startDate = addDaysYmd(targetDate, startOffsetDays);
  const endDate = addDaysYmd(startDate, spanDays);
  const item = {
    accountId: entry.accountId,
    calendarId: entry.calendarId,
    title: entry.title || "",
    allDay: !!entry.allDay,
    startDate,
    endDate,
    startTime: entry.allDay ? null : entry.startTime,
    endTime: entry.allDay ? null : entry.endTime,
    location: entry.location || "",
    description: entry.description || "",
  };
  if (entry.colorId) item.colorId = entry.colorId;
  return item;
}

export function planCalendarEventClipboardPaste(clipboard, targetDate) {
  const events = Array.isArray(clipboard?.events) ? clipboard.events : [];
  if (clipboard?.kind !== "calendar-event-clipboard" || !events.length || !stablePart(targetDate)) {
    return null;
  }
  const anchorDate = events.reduce((earliest, event) => (
    event.startDate && event.startDate < earliest ? event.startDate : earliest
  ), events[0].startDate);
  return {
    kind: "calendar-event-paste-plan",
    anchorDate,
    targetDate,
    items: events.map((event) => pasteItemFromClipboardEvent(event, { anchorDate, targetDate })),
  };
}
