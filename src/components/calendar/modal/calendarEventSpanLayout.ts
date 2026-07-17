import {
  addDaysYmd,
  pacificTime24,
  pacificYMD,
} from "../calendarDateUtils.ts";
import { formatTime12FromTime24 } from "../ghostPreview.ts";
import { getEventSelectionId } from "../../../lib/shell-helpers";
import {
  googleSpecialDateAccent,
  isGoogleSpecialDateEvent,
} from "../googleSpecialDateModel.ts";
import type { TimelineEvent } from "../../../lib/shell-helpers";
import type { CalendarLayoutTier } from "./calendarCellItemMetrics";
import type { CalendarMonthCell } from "./calendarGridUtils";

export interface CalendarSpanEvent extends TimelineEvent {
  id?: unknown;
  title?: unknown;
  allDay?: boolean;
  startMs?: number | null;
  endMs?: number | null;
  writable?: boolean;
  eventType?: string | null;
  color?: string;
  sourceColor?: string;
  isRecurring?: boolean;
  recurring?: boolean;
}

export interface CalendarSpanGhost {
  id?: unknown;
  kind?: string;
  title?: unknown;
  startDate?: string;
  endDate?: string;
  startTime?: string | null;
  allDay?: boolean;
  color?: string;
  sourceColor?: string;
  recurring?: boolean;
  [key: string]: unknown;
}

export type CalendarSpanItem = CalendarSpanEvent | CalendarSpanGhost;
export type CalendarSpanKind = "event" | "ghost";
export interface CalendarDateRange { startDate: string; endDate: string }
export interface CalendarSpanLayoutMetrics { tier?: CalendarLayoutTier; cellHeight?: number }
interface CalendarDateIndexEntry { index: number; row: number; column: number }

interface CalendarSpanCandidate {
  id: string;
  eventId: string | null;
  kind: CalendarSpanKind;
  item: CalendarSpanItem;
  originalStartDate: string;
  startDate: string;
  endDate: string;
  interactive: boolean;
  readOnly: boolean;
}

export interface CalendarSpanSegment {
  id: string;
  item: CalendarSpanItem;
  kind: CalendarSpanKind;
  eventId: string | null;
  dateKey: string;
  segmentStart: string;
  segmentEnd: string;
  row: number;
  columnStart: number;
  columnEnd: number;
  lane: number;
  startsBeforeSegment: boolean;
  endsAfterSegment: boolean;
  interactive: boolean;
  readOnly: boolean;
}

export interface CalendarEventSpanLayout {
  spanSegments: CalendarSpanSegment[];
  pinnedByDate: Record<string, CalendarSpanItem[]>;
  pinnedIdsByDate: Record<string, Set<string>>;
  reservedLaneCountByDate: Record<string, number>;
  pinnedGhostCountByDate: Record<string, number>;
  pinnedIds: Set<string>;
  pinnedOverflowByDate: Record<string, Set<string>>;
}

// Lane geometry contract: CalendarEventSpanOverlay draws pinned lanes with
// this height/gap, and EventsCellContent feeds the same values into
// getReservedCellItemLaneHeight so stacked chips clear the lanes exactly.
export const SPAN_LANE_HEIGHT = 36;
export const SPAN_LANE_GAP = 4;

function localDateFromMs(ms: number | null | undefined): string | null {
  return Number.isFinite(ms) ? pacificYMD(ms) : null;
}

function eventTitle(item: CalendarSpanItem | null | undefined): string {
  return String(item?.title || "").trim() || "(No title)";
}

function comparePinnedItems(a: CalendarSpanCandidate, b: CalendarSpanCandidate): number {
  const aItem = a.item || {};
  const bItem = b.item || {};
  const aAllDay = !!aItem.allDay;
  const bAllDay = !!bItem.allDay;
  if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
  const aStart = typeof aItem.startMs === "number" ? aItem.startMs : 0;
  const bStart = typeof bItem.startMs === "number" ? bItem.startMs : 0;
  if (aStart !== bStart) return aStart - bStart;
  return eventTitle(aItem).localeCompare(eventTitle(bItem));
}

function normalizeRange(startDate: string | null | undefined, endDate: string | null | undefined): CalendarDateRange | null {
  if (!startDate || !endDate) return null;
  if (endDate < startDate) return { startDate, endDate: startDate };
  return { startDate, endDate };
}

export function visualEventDateRange(event: CalendarSpanEvent | null | undefined): CalendarDateRange | null {
  if (!event) return null;

  if (event.allDay) {
    const startDate = localDateFromMs(event.startMs);
    const endExclusive = localDateFromMs(event.endMs) || startDate;
    const endDate = endExclusive ? addDaysYmd(endExclusive, -1) : startDate;
    return normalizeRange(startDate, endDate);
  }

  const startDate = localDateFromMs(event.startMs);
  let endDate = localDateFromMs(event.endMs) || startDate;
  if (!startDate || !endDate) return null;

  if ((event.endMs ?? 0) > (event.startMs ?? 0) && pacificTime24(event.endMs) === "00:00") {
    endDate = addDaysYmd(endDate, -1);
  }

  return normalizeRange(startDate, endDate);
}

function visualGhostDateRange(ghost: CalendarSpanGhost | null | undefined): CalendarDateRange | null {
  if (!ghost?.startDate || !ghost?.endDate) return null;
  return normalizeRange(ghost.startDate, ghost.endDate);
}

export function spanLaneMetrics(layout?: CalendarSpanLayoutMetrics | null): { rowTop: number; height: number; gap: number } {
  return {
    rowTop: layout?.tier === "uhd" || layout?.tier === "xl" ? 32 : 30,
    height: SPAN_LANE_HEIGHT,
    gap: SPAN_LANE_GAP,
  };
}

export function maxSpanLanes(cellHeight: number, layout?: CalendarSpanLayoutMetrics | null): number {
  const { rowTop, height, gap } = spanLaneMetrics(layout);
  if (cellHeight <= rowTop + height) return 1;
  return Math.floor((cellHeight - rowTop - height) / (height + gap)) + 1;
}

export function isPinnedCalendarEvent(event: CalendarSpanEvent | null | undefined): boolean {
  const range = pinnedEventDateRange(event);
  return !!range;
}

function pinnedEventDateRange(event: CalendarSpanEvent | null | undefined): CalendarDateRange | null {
  const range = visualEventDateRange(event);
  if (!range) return null;
  if (event?.allDay) return range;
  if (range.startDate === range.endDate) return null;
  const continuationStart = addDaysYmd(range.startDate, 1);
  return normalizeRange(continuationStart, range.endDate);
}

export function isPinnedCalendarGhost(ghost: CalendarSpanGhost | null | undefined): boolean {
  const range = visualGhostDateRange(ghost);
  if (!range) return false;
  return !!ghost?.allDay || range.startDate !== range.endDate;
}

function eventSpanId(event: CalendarSpanEvent): string | null {
  return getEventSelectionId(event);
}

function ghostSpanId(ghost: CalendarSpanGhost): string {
  return String(ghost?.id || `ghost-${ghost?.startDate || "date"}-${eventTitle(ghost)}`);
}

function toCandidate(item: CalendarSpanItem, kind: CalendarSpanKind): CalendarSpanCandidate | null {
  const event = item as CalendarSpanEvent;
  const ghost = item as CalendarSpanGhost;
  const visualRange = kind === "event" ? visualEventDateRange(event) : visualGhostDateRange(ghost);
  const range = kind === "event" ? pinnedEventDateRange(event) : visualRange;
  if (!range) return null;

  const id = kind === "event" ? eventSpanId(event) : ghostSpanId(ghost);
  if (!id) return null;

  return {
    id: `${kind}:${id}`,
    eventId: kind === "event" ? String(id) : null,
    kind,
    item,
    originalStartDate: visualRange?.startDate || range.startDate,
    startDate: range.startDate,
    endDate: range.endDate,
    interactive: kind === "event",
    readOnly: kind === "event"
      ? event.writable === false || (!!event.eventType && event.eventType !== "default")
      : true,
  };
}

function buildDateIndex(monthCells: readonly Pick<CalendarMonthCell, "dateKey">[] | null | undefined): Map<string, CalendarDateIndexEntry> {
  const index = new Map<string, CalendarDateIndexEntry>();
  (monthCells || []).forEach((cell, cellIndex) => {
    if (!cell?.dateKey) return;
    index.set(cell.dateKey, {
      index: cellIndex,
      row: Math.floor(cellIndex / 7) + 1,
      column: (cellIndex % 7) + 1,
    });
  });
  return index;
}

function splitCandidateByRows(candidate: CalendarSpanCandidate, dateIndex: Map<string, CalendarDateIndexEntry>, firstVisible: string, lastVisible: string): CalendarSpanSegment[] {
  const start = candidate.startDate < firstVisible ? firstVisible : candidate.startDate;
  const end = candidate.endDate > lastVisible ? lastVisible : candidate.endDate;
  if (!start || !end || end < start) return [];

  const segments: CalendarSpanSegment[] = [];
  let cursor = start;
  while (cursor <= end) {
    const startPos = dateIndex.get(cursor);
    if (!startPos) {
      cursor = addDaysYmd(cursor, 1);
      continue;
    }

    let segmentEnd = cursor;
    let endPos = startPos;
    while (addDaysYmd(segmentEnd, 1) <= end) {
      const nextDate = addDaysYmd(segmentEnd, 1);
      const nextPos = dateIndex.get(nextDate);
      if (!nextPos || nextPos.row !== startPos.row) break;
      segmentEnd = nextDate;
      endPos = nextPos;
    }

    segments.push({
      id: `${candidate.id}:${cursor}:${segmentEnd}`,
      item: candidate.item,
      kind: candidate.kind,
      eventId: candidate.eventId,
      dateKey: cursor,
      segmentStart: cursor,
      segmentEnd,
      row: startPos.row,
      columnStart: startPos.column,
      columnEnd: endPos.column + 1,
      lane: 0,
      startsBeforeSegment: candidate.originalStartDate < cursor,
      endsAfterSegment: candidate.endDate > segmentEnd,
      interactive: candidate.interactive,
      readOnly: candidate.readOnly,
    });
    cursor = addDaysYmd(segmentEnd, 1);
  }

  return segments;
}

function segmentDates(segment: CalendarSpanSegment): string[] {
  const dates: string[] = [];
  let cursor = segment.segmentStart;
  while (cursor <= segment.segmentEnd) {
    dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return dates;
}

type CalendarRowLanes = Map<number, Set<string>>;

function laneIsFree(rowLanes: CalendarRowLanes, lane: number, segment: CalendarSpanSegment): boolean {
  const occupied = rowLanes.get(lane);
  if (!occupied) return true;
  return segmentDates(segment).every((date) => !occupied.has(date));
}

function occupyLane(rowLanes: CalendarRowLanes, lane: number, segment: CalendarSpanSegment): void {
  let occupied = rowLanes.get(lane);
  if (!occupied) {
    occupied = new Set<string>();
    rowLanes.set(lane, occupied);
  }
  segmentDates(segment).forEach((date) => occupied.add(date));
}

function firstFreeLane(rowLanes: CalendarRowLanes, segment: CalendarSpanSegment, preferredLane: number | null = null): number {
  if (preferredLane != null && Number.isFinite(preferredLane) && laneIsFree(rowLanes, preferredLane, segment)) {
    return preferredLane;
  }
  for (let lane = 0; lane < 12; lane += 1) {
    if (laneIsFree(rowLanes, lane, segment)) return lane;
  }
  return rowLanes.size;
}

function itemLeadingLabel(segment: CalendarSpanSegment): string {
  const item = segment.item || {};
  if (segment.startsBeforeSegment) return "<";
  if (item.allDay) return "All day";
  if (segment.kind === "ghost") return formatTime12FromTime24((item as CalendarSpanGhost).startTime);
  const startMs = (item as CalendarSpanEvent).startMs;
  return Number.isFinite(startMs)
    ? new Date(startMs!).toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";
}

export function spanSegmentDisplay(segment: CalendarSpanSegment): { title: string; leadingLabel: string; recurring: boolean; color: string; specialDate: boolean; specialDateAccent: string } {
  const specialDate = isGoogleSpecialDateEvent(segment?.item);
  const color = specialDate
    ? googleSpecialDateAccent(segment?.item)
    : segment?.item?.color || segment?.item?.sourceColor || "#89b4fa";
  return {
    title: eventTitle(segment?.item),
    leadingLabel: specialDate ? "" : itemLeadingLabel(segment),
    recurring: specialDate ? false : !!segment?.item?.isRecurring || !!segment?.item?.recurring,
    color,
    specialDate,
    specialDateAccent: color,
  };
}

export function eventVisuallyOverlapsRange(event: CalendarSpanEvent, startDate: string, endDate: string): boolean {
  const range = visualEventDateRange(event);
  return !!range && range.startDate <= endDate && range.endDate >= startDate;
}

export function calendarEventTouchedMonths(event: CalendarSpanEvent): string[] {
  const range = visualEventDateRange(event);
  if (!range) return [];
  const months: string[] = [];
  let cursor = `${range.startDate.slice(0, 7)}-01`;
  const last = `${range.endDate.slice(0, 7)}-01`;
  while (cursor <= last) {
    months.push(cursor.slice(0, 7));
    cursor = addDaysYmd(cursor, 32).slice(0, 7) + "-01";
  }
  return months;
}

export function buildCalendarEventSpanLayout({
  monthCells,
  events,
  ghosts,
  layout,
}: { monthCells?: Array<Pick<CalendarMonthCell, "dateKey">>; events?: CalendarSpanEvent[]; ghosts?: CalendarSpanGhost[]; layout?: CalendarSpanLayoutMetrics } = {}): CalendarEventSpanLayout {
  const dateIndex = buildDateIndex(monthCells);
  const visibleDates = (monthCells || []).map((cell) => cell.dateKey).filter(Boolean);
  const firstVisible = visibleDates[0];
  const lastVisible = visibleDates[visibleDates.length - 1];
  const pinnedByDate: Record<string, CalendarSpanItem[]> = {};
  const pinnedIdsByDate: Record<string, Set<string>> = {};
  const reservedLaneCountByDate: Record<string, number> = {};
  const pinnedGhostCountByDate: Record<string, number> = {};
  const pinnedIds = new Set<string>();
  const pinnedOverflowByDate: Record<string, Set<string>> = {};
  const laneCapacity = layout?.cellHeight ? maxSpanLanes(layout.cellHeight, layout) : 12;

  if (!firstVisible || !lastVisible) {
    return { spanSegments: [], pinnedByDate, pinnedIdsByDate, reservedLaneCountByDate, pinnedGhostCountByDate, pinnedIds, pinnedOverflowByDate };
  }

  const eventCandidates = (events || [])
    .filter(isPinnedCalendarEvent)
    .map((event) => toCandidate(event, "event"))
    .filter((candidate): candidate is CalendarSpanCandidate => Boolean(candidate));
  const ghostCandidates = (ghosts || [])
    .filter((ghost) => ghost?.kind === "event" && isPinnedCalendarGhost(ghost))
    .map((ghost) => toCandidate(ghost, "ghost"))
    .filter((candidate): candidate is CalendarSpanCandidate => Boolean(candidate));
  const candidates = [...eventCandidates, ...ghostCandidates]
    .filter((candidate) => candidate.startDate <= lastVisible && candidate.endDate >= firstVisible)
    .sort(comparePinnedItems);

  for (const candidate of candidates) {
    let cursor = candidate.startDate < firstVisible ? firstVisible : candidate.startDate;
    const end = candidate.endDate > lastVisible ? lastVisible : candidate.endDate;
    while (cursor <= end) {
      if (dateIndex.has(cursor)) {
        if (!pinnedByDate[cursor]) pinnedByDate[cursor] = [];
        pinnedByDate[cursor]!.push(candidate.item);
        if (candidate.kind === "event" && candidate.eventId) {
          if (!pinnedIdsByDate[cursor]) pinnedIdsByDate[cursor] = new Set();
          pinnedIdsByDate[cursor]!.add(candidate.eventId);
        }
        if (candidate.kind === "ghost") {
          pinnedGhostCountByDate[cursor] = (pinnedGhostCountByDate[cursor] || 0) + 1;
        }
      }
      cursor = addDaysYmd(cursor, 1);
    }
    if (candidate.kind === "event" && candidate.eventId) pinnedIds.add(candidate.eventId);
  }

  const rowLanesByRow = new Map<number, CalendarRowLanes>();
  const preferredLaneByCandidate = new Map<string, number>();
  const spanSegments: CalendarSpanSegment[] = [];

  for (const candidate of candidates) {
    const candidateSegments = splitCandidateByRows(candidate, dateIndex, firstVisible, lastVisible);
    for (const segment of candidateSegments) {
      let rowLanes = rowLanesByRow.get(segment.row);
      if (!rowLanes) {
        rowLanes = new Map<number, Set<string>>();
        rowLanesByRow.set(segment.row, rowLanes);
      }
      const preferredLane = preferredLaneByCandidate.get(candidate.id);
      const lane = firstFreeLane(rowLanes, segment, preferredLane);
      preferredLaneByCandidate.set(candidate.id, lane);
      occupyLane(rowLanes, lane, segment);

      if (lane < laneCapacity) {
        const nextSegment = { ...segment, lane };
        segmentDates(nextSegment).forEach((date) => {
          reservedLaneCountByDate[date] = Math.max(reservedLaneCountByDate[date] || 0, lane + 1);
        });
        spanSegments.push(nextSegment);
      } else {
        segmentDates(segment).forEach((date) => {
          if (!pinnedOverflowByDate[date]) pinnedOverflowByDate[date] = new Set();
          if (candidate.eventId) pinnedOverflowByDate[date]!.add(candidate.eventId);
        });
      }
    }
  }

  return {
    spanSegments,
    pinnedByDate,
    pinnedIdsByDate,
    reservedLaneCountByDate,
    pinnedGhostCountByDate,
    pinnedIds,
    pinnedOverflowByDate,
  };
}
