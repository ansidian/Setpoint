import {
  addDaysYmd,
  daysBetweenYmd,
  pacificTime24,
  pacificYMD,
} from "../calendarDateUtils.ts";
import { isGoogleSpecialDateEvent } from "../googleSpecialDateModel.ts";

export interface SelectableCalendarEvent {
  id?: string | number | null;
  accountId?: string;
  calendarId?: string;
  title?: string;
  startMs?: number | null;
  endMs?: number;
  allDay?: boolean;
  writable?: boolean;
  isRecurring?: boolean;
  recurringEventId?: string | null;
  originalStartTime?: string | null;
  location?: string;
  description?: string;
  colorId?: string | number | null;
  sourceColorId?: string | null;
  agendaItemKind?: string;
  kind?: string;
  billId?: string | number | null;
  ghostKind?: string | null;
  _calendarGhost?: boolean;
  resultKind?: string;
  searchResult?: boolean;
  source?: string;
  sourceLabel?: string;
  startDate?: string;
  eventType?: string;
  birthdayProperties?: Record<string, unknown> | null;
  payload?: Record<string, unknown>;
}

export interface CalendarEventSelectionEntry {
  identity: string;
  event: SelectableCalendarEvent;
}

export interface CalendarEventSelectionSet {
  items: CalendarEventSelectionEntry[];
}

export type CalendarEventActionScope =
  | { kind: "none"; events: []; identities: [] }
  | { kind: "single" | "selection"; events: SelectableCalendarEvent[]; identities: string[] };

export interface CalendarEventClipboardEntry {
  sourceIdentity: string | null;
  accountId?: string;
  calendarId?: string;
  title: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  location?: string;
  description?: string;
  colorId: string | number | null;
}

export interface CalendarEventClipboard {
  kind: "calendar-event-clipboard";
  version: 1;
  events: CalendarEventClipboardEntry[];
}

export interface CalendarEventPasteItem {
  accountId?: string;
  calendarId?: string;
  title: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  location?: string;
  description?: string;
  colorId?: string | number;
}

function stablePart(value: unknown) {
  return String(value ?? "").trim();
}

function hasFiniteMs(value: unknown) {
  return Number.isFinite(Number(value));
}

function isExcludedSelectionSource(event: SelectableCalendarEvent | null | undefined) {
  return event?.agendaItemKind === "deadline"
    || event?.kind === "bill"
    || event?.billId != null
    || event?.ghostKind != null
    || event?._calendarGhost === true
    || event?.resultKind === "calendar-search-result"
    || event?.searchResult === true
    || isGoogleSpecialDateEvent(event);
}

function calendarEventOccurrenceKey(event: SelectableCalendarEvent | null | undefined) {
  if (event?.isRecurring || event?.recurringEventId || event?.originalStartTime) {
    return stablePart(event.originalStartTime || event.startMs || event.id);
  }
  return stablePart(event?.id);
}

export function isCalendarEventSelectionEligible(
  event: SelectableCalendarEvent | null | undefined,
): event is SelectableCalendarEvent {
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

// Shared modifier predicate for the cmd/ctrl multi-select gesture. Every calendar
// surface that forwards modifier-clicks must use this single definition (FLOWS.md flow 5).
export function isEventSelectionModifier(
  event: Partial<Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">> | null | undefined,
) {
  return !!(event?.metaKey || event?.ctrlKey);
}

export function calendarEventSelectionIdentity(event: SelectableCalendarEvent | null | undefined) {
  if (!isCalendarEventSelectionEligible(event)) return null;
  const seriesOrEventId = stablePart(event.recurringEventId || event.id);
  return [
    stablePart(event.accountId),
    stablePart(event.calendarId),
    seriesOrEventId,
    calendarEventOccurrenceKey(event),
  ].join("::");
}

function normalizeSelection(selection: CalendarEventSelectionSet | null | undefined): CalendarEventSelectionSet {
  if (!selection?.items || !Array.isArray(selection.items)) {
    return createCalendarEventSelectionSet();
  }
  const byIdentity = new Map<string, CalendarEventSelectionEntry>();
  for (const item of selection.items) {
    if (!item?.identity || !item.event) continue;
    byIdentity.set(item.identity, {
      identity: item.identity,
      event: { ...item.event },
    });
  }
  return { items: Array.from(byIdentity.values()) };
}

export function createCalendarEventSelectionSet(events: SelectableCalendarEvent[] = []): CalendarEventSelectionSet {
  const selection: CalendarEventSelectionSet = { items: [] };
  for (const event of events) {
    const identity = calendarEventSelectionIdentity(event);
    if (!identity) continue;
    selection.items.push({ identity, event: { ...event } });
  }
  return normalizeSelection(selection);
}

export function isCalendarEventSelected(
  selection: CalendarEventSelectionSet | null | undefined,
  event: SelectableCalendarEvent | null | undefined,
) {
  const identity = calendarEventSelectionIdentity(event);
  if (!identity) return false;
  return normalizeSelection(selection).items.some((item) => item.identity === identity);
}

export function toggleCalendarEventSelection(
  selection: CalendarEventSelectionSet | null | undefined,
  event: SelectableCalendarEvent | null | undefined,
) {
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

export function addCalendarEventSelection(
  selection: CalendarEventSelectionSet | null | undefined,
  event: SelectableCalendarEvent | null | undefined,
) {
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

export function removeCalendarEventSelection(
  selection: CalendarEventSelectionSet | null | undefined,
  eventOrIdentity: SelectableCalendarEvent | string | null | undefined,
) {
  const identity = typeof eventOrIdentity === "string"
    ? eventOrIdentity
    : calendarEventSelectionIdentity(eventOrIdentity);
  const current = normalizeSelection(selection);
  if (!identity) return current;
  return {
    items: current.items.filter((item) => item.identity !== identity),
  };
}

export function clearCalendarEventSelection(): CalendarEventSelectionSet {
  return { items: [] };
}

export function calendarEventSelectionSize(selection: CalendarEventSelectionSet | null | undefined) {
  return normalizeSelection(selection).items.length;
}

function selectedEventSortValue(event: SelectableCalendarEvent) {
  return Number.isFinite(Number(event?.startMs)) ? Number(event.startMs) : 0;
}

export function getOrderedCalendarEventSelection(
  selection: CalendarEventSelectionSet | null | undefined,
): SelectableCalendarEvent[] {
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

function orderedSelectionEntries(selection: CalendarEventSelectionSet | null | undefined) {
  const normalized = normalizeSelection(selection);
  const orderedEvents = getOrderedCalendarEventSelection(normalized);
  return orderedEvents.map((event) => ({
    identity: calendarEventSelectionIdentity(event),
    event,
  })).filter((item): item is { identity: string; event: SelectableCalendarEvent } => Boolean(item.identity));
}

export function resolveCalendarEventActionScope(
  selection: CalendarEventSelectionSet | null | undefined,
  contextEvent: SelectableCalendarEvent | null | undefined,
): CalendarEventActionScope {
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

function eventsFromClipboardSource(
  source: SelectableCalendarEvent[] | SelectableCalendarEvent | CalendarEventSelectionSet | null | undefined,
) {
  if (Array.isArray(source)) {
    return getOrderedCalendarEventSelection(createCalendarEventSelectionSet(source));
  }
  if (source && "items" in source) {
    return getOrderedCalendarEventSelection(source);
  }
  if (isCalendarEventSelectionEligible(source)) {
    return [source];
  }
  return [];
}

function calendarEventDateRange(event: SelectableCalendarEvent) {
  const startDate = pacificYMD(Number(event.startMs));
  const endDate = event.allDay
    ? addDaysYmd(pacificYMD(Number(event.endMs || event.startMs)), -1)
    : pacificYMD(Number(event.endMs || event.startMs));
  return { startDate, endDate };
}

function clipboardEventFromCalendarEvent(event: SelectableCalendarEvent): CalendarEventClipboardEntry {
  const { startDate, endDate } = calendarEventDateRange(event);
  return {
    sourceIdentity: calendarEventSelectionIdentity(event),
    accountId: event.accountId,
    calendarId: event.calendarId,
    title: event.title || "",
    allDay: !!event.allDay,
    startDate,
    endDate,
    startTime: event.allDay ? null : pacificTime24(Number(event.startMs)),
    endTime: event.allDay ? null : pacificTime24(Number(event.endMs || event.startMs)),
    location: event.location || "",
    description: event.description || "",
    colorId: event.colorId || event.sourceColorId || null,
  };
}

export function createCalendarEventClipboard(
  source: SelectableCalendarEvent[] | SelectableCalendarEvent | CalendarEventSelectionSet | null | undefined,
): CalendarEventClipboard | null {
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

function pasteItemFromClipboardEvent(
  entry: CalendarEventClipboardEntry,
  { anchorDate, targetDate }: { anchorDate: string; targetDate: string },
): CalendarEventPasteItem {
  const startOffsetDays = daysBetweenYmd(anchorDate, entry.startDate);
  const spanDays = daysBetweenYmd(entry.startDate, entry.endDate);
  const startDate = addDaysYmd(targetDate, startOffsetDays);
  const endDate = addDaysYmd(startDate, spanDays);
  const item: CalendarEventPasteItem = {
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

export function planCalendarEventClipboardPaste(
  clipboard: CalendarEventClipboard | null | undefined,
  targetDate: string | null | undefined,
) {
  const events = Array.isArray(clipboard?.events) ? clipboard.events : [];
  if (clipboard?.kind !== "calendar-event-clipboard" || !events.length || !stablePart(targetDate)) {
    return null;
  }
  const resolvedTargetDate = String(targetDate);
  const anchorDate = events.reduce((earliest, event) => (
    event.startDate && event.startDate < earliest ? event.startDate : earliest
  ), events[0]!.startDate);
  return {
    kind: "calendar-event-paste-plan",
    anchorDate,
    targetDate: resolvedTargetDate,
    items: events.map((event) => pasteItemFromClipboardEvent(event, { anchorDate, targetDate: resolvedTargetDate })),
  };
}
