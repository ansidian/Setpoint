import {
  addDaysYmd,
  pacificTime24,
  pacificYMD,
  parseYmd,
  ymdFromParts,
} from "../../calendarDateUtils.ts";
import type { CalendarItemLike } from "../calendarViewTypes";

export const MINI_CALENDAR_CELL_COUNT = 42;
export const MINI_CALENDAR_MARKER_LIMIT = 4;
const DEFAULT_MARKER_COLOR = "#89b4fa";

export interface MiniCalendarDateRange { startDate: string; endDate: string }
export interface MiniCalendarMarker {
  kind: "dot" | "deadline";
  shape: "dot" | "check";
  itemId: string;
  dateKey: string;
  color: string;
  count: number;
  sourceKind: string | null;
  order: number | null;
  representsOverflow: boolean;
}
export interface MiniCalendarCell {
  dateKey: string;
  day: number | null;
  rowIndex: number;
  weekdayIndex: number;
  inCurrentMonth: boolean;
  adjacentPosition: "current" | "leading" | "trailing";
  isToday: boolean;
  isSelected: boolean;
  isActivated: boolean;
}
interface MiniCalendarSignalGroup { dots: CalendarItemLike[]; deadlines: CalendarItemLike[] }

function itemId(item: CalendarItemLike): string {
  return String(item?.agendaItemId || item?.id || item?.key || "");
}

function markerColor(item: CalendarItemLike): string {
  return item?.markerColor
    || item?.agendaDotColor
    || item?.agendaSourceColor
    || item?.agendaSelectedColor
    || item?.sourceColor
    || item?.color
    || DEFAULT_MARKER_COLOR;
}

function itemKind(item: CalendarItemLike): string {
  return String(item?.kind || item?.agendaItemKind || item?.type || "").toLowerCase();
}

function isDeadlineItem(item: CalendarItemLike): boolean {
  const kind = itemKind(item);
  return kind === "deadline" || kind === "task" || item?.isDeadline === true;
}

function dateFromMs(ms: number | null | undefined): string | null {
  return Number.isFinite(ms) ? pacificYMD(ms as number) : null;
}

function normalizeRange(startDate: string | null | undefined, endDate = startDate): MiniCalendarDateRange | null {
  if (!startDate) return null;
  const end = endDate || startDate;
  return end < startDate
    ? { startDate, endDate: startDate }
    : { startDate, endDate: end };
}

export function resolveMiniCalendarItemDateRange(item: CalendarItemLike | null | undefined): MiniCalendarDateRange | null {
  if (!item) return null;

  const explicitStart = item.startDate
    || item.dateKey
    || item.agendaDateKey
    || item.due_date
    || item.dueDate
    || item.next_date
    || item.nextDate
    || null;
  const explicitEnd = item.endDate || item.end_date || null;
  if (explicitStart) return normalizeRange(explicitStart, explicitEnd || explicitStart);

  const startDate = dateFromMs(item.startMs);
  if (!startDate) return null;

  if (item.allDay) {
    const endExclusive = dateFromMs(item.endMs) || startDate;
    const endDate = endExclusive ? addDaysYmd(endExclusive, -1) : startDate;
    return normalizeRange(startDate, endDate);
  }

  let endDate = dateFromMs(item.endMs) || startDate;
  if (typeof item.endMs === "number" && typeof item.startMs === "number" && item.endMs > item.startMs && pacificTime24(item.endMs) === "00:00") {
    endDate = addDaysYmd(endDate, -1);
  }
  return normalizeRange(startDate, endDate);
}

function dateKeysInRange(range: MiniCalendarDateRange | null | undefined): string[] {
  if (!range?.startDate || !range?.endDate) return [];
  const dates = [];
  let cursor = range.startDate;
  while (cursor <= range.endDate) {
    dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return dates;
}

function groupedSignals(items: CalendarItemLike[]): Map<string, MiniCalendarSignalGroup> {
  const byDate = new Map<string, MiniCalendarSignalGroup>();
  for (const item of items || []) {
    const range = resolveMiniCalendarItemDateRange(item);
    if (!range) continue;
    for (const dateKey of dateKeysInRange(range)) {
      const group = byDate.get(dateKey) || { dots: [], deadlines: [] };
      if (isDeadlineItem(item)) group.deadlines.push(item);
      else group.dots.push(item);
      byDate.set(dateKey, group);
    }
  }
  return byDate;
}

function dotMarker(item: CalendarItemLike, index: number, dateKey: string): MiniCalendarMarker {
  return {
    kind: "dot",
    shape: "dot",
    itemId: itemId(item),
    dateKey,
    color: markerColor(item),
    count: 1,
    sourceKind: itemKind(item) || null,
    order: index,
    representsOverflow: false,
  };
}

function deadlineMarker(deadlines: CalendarItemLike[], dateKey: string): MiniCalendarMarker {
  const first = deadlines[0];
  if (!first) throw new Error("deadlineMarker requires at least one deadline");
  return {
    kind: "deadline",
    shape: "check",
    itemId: itemId(first),
    dateKey,
    color: markerColor(first),
    count: deadlines.length,
    sourceKind: "deadline",
    order: null,
    representsOverflow: false,
  };
}

function capMarkers({ dots, deadlines }: MiniCalendarSignalGroup, dateKey: string): MiniCalendarMarker[] {
  const hasDeadline = deadlines.length > 0;
  const maxDots = hasDeadline ? MINI_CALENDAR_MARKER_LIMIT - 1 : MINI_CALENDAR_MARKER_LIMIT;
  const markers = dots.slice(0, maxDots).map((item, index) => dotMarker(item, index, dateKey));
  if (hasDeadline) markers.push(deadlineMarker(deadlines, dateKey));

  if (markers.length === MINI_CALENDAR_MARKER_LIMIT && dots.length + (hasDeadline ? 1 : 0) >= MINI_CALENDAR_MARKER_LIMIT) {
    const last = markers[markers.length - 1];
    if (last) markers[markers.length - 1] = { ...last, representsOverflow: true };
  }

  return markers;
}

export function deriveMiniCalendarActivityMarkers(items: CalendarItemLike[] = []): Record<string, MiniCalendarMarker[]> {
  const groups = groupedSignals(items);
  const markersByDate: Record<string, MiniCalendarMarker[]> = {};
  for (const [dateKey, group] of groups.entries()) {
    const markers = capMarkers(group, dateKey);
    if (markers.length) markersByDate[dateKey] = markers;
  }
  return markersByDate;
}

export function buildMiniCalendarCells({
  viewYear,
  viewMonth,
  todayKey = null,
  selectedDateKey = null,
  activatedDateKey = null,
}: {
  viewYear: number;
  viewMonth: number;
  todayKey?: string | null;
  selectedDateKey?: string | null;
  activatedDateKey?: string | null;
}): MiniCalendarCell[] {
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const monthStartKey = ymdFromParts(viewYear, viewMonth, 1);

  return Array.from({ length: MINI_CALENDAR_CELL_COUNT }, (_, index) => {
    const date = new Date(Date.UTC(viewYear, viewMonth, 1, 12));
    date.setUTCDate(date.getUTCDate() - firstDay + index);
    const dateKey = date.toISOString().slice(0, 10);
    const parsed = parseYmd(dateKey);
    const inCurrentMonth = parsed?.year === viewYear && parsed?.month === viewMonth;
    return {
      dateKey,
      day: parsed?.day || null,
      rowIndex: Math.floor(index / 7),
      weekdayIndex: index % 7,
      inCurrentMonth,
      adjacentPosition: inCurrentMonth
        ? "current"
        : dateKey < monthStartKey
          ? "leading"
          : "trailing",
      isToday: dateKey === todayKey,
      isSelected: dateKey === selectedDateKey,
      isActivated: dateKey === activatedDateKey,
    };
  });
}

export interface MiniCalendarPreviewSegment {
  rowIndex: number;
  columnStart: number;
  columnEnd: number;
  segmentStart: string;
  segmentEnd: string;
  startsBeforeSegment: boolean;
  endsAfterSegment: boolean;
}

function segmentPreviewDates(dateKeys: string[], cellIndex: Map<string, MiniCalendarCell>): MiniCalendarPreviewSegment[] {
  const segments: MiniCalendarPreviewSegment[] = [];
  let segmentStart: string | null = null;
  let segmentEnd: string | null = null;
  let startCell: MiniCalendarCell | null = null;
  let endCell: MiniCalendarCell | null = null;

  const flush = () => {
    if (!segmentStart || !segmentEnd || !startCell || !endCell) return;
    segments.push({
      rowIndex: startCell.rowIndex,
      columnStart: startCell.weekdayIndex,
      columnEnd: endCell.weekdayIndex + 1,
      segmentStart,
      segmentEnd,
      startsBeforeSegment: (dateKeys[0] || segmentStart) < segmentStart,
      endsAfterSegment: (dateKeys[dateKeys.length - 1] || segmentEnd) > segmentEnd,
    });
  };

  for (const dateKey of dateKeys) {
    const cell = cellIndex.get(dateKey);
    if (!cell) {
      flush();
      segmentStart = null;
      segmentEnd = null;
      startCell = null;
      endCell = null;
      continue;
    }

    if (!startCell || cell.rowIndex !== startCell.rowIndex) {
      flush();
      segmentStart = dateKey;
      startCell = cell;
    }

    segmentEnd = dateKey;
    endCell = cell;
  }

  flush();
  return segments;
}

export function buildMiniCalendarHoverPreview({ item, cells = [] }: {
  item?: CalendarItemLike | null;
  cells?: MiniCalendarCell[];
} = {}) {
  const range = resolveMiniCalendarItemDateRange(item);
  if (!range) return null;

  const dateKeys = dateKeysInRange(range);
  const cellIndex = new Map((cells || []).map((cell) => [cell.dateKey, cell]));
  const resolvedItem = item as CalendarItemLike;
  const id = itemId(resolvedItem);
  return {
    itemId: id || null,
    kind: itemKind(resolvedItem) || null,
    color: markerColor(resolvedItem),
    startDate: range.startDate,
    endDate: range.endDate,
    dateKeys,
    isMultiDayAllDay: !!resolvedItem.allDay && dateKeys.length > 1,
    segments: segmentPreviewDates(dateKeys, cellIndex),
  };
}

export function buildMiniCalendarModel({
  viewYear,
  viewMonth,
  todayKey = null,
  selectedDateKey = null,
  activatedDateKey = null,
  activityItems = [],
  hoverPreviewItem = null,
}: {
  viewYear: number;
  viewMonth: number;
  todayKey?: string | null;
  selectedDateKey?: string | null;
  activatedDateKey?: string | null;
  activityItems?: CalendarItemLike[];
  hoverPreviewItem?: CalendarItemLike | null;
}) {
  const baseCells = buildMiniCalendarCells({
    viewYear,
    viewMonth,
    todayKey,
    selectedDateKey,
    activatedDateKey,
  });
  const markersByDate = deriveMiniCalendarActivityMarkers(activityItems);
  const preview = buildMiniCalendarHoverPreview({ item: hoverPreviewItem, cells: baseCells });
  const previewByDate = new Map((preview?.dateKeys || []).map((dateKey) => [dateKey, preview]));
  const cells = baseCells.map((cell) => ({
    ...cell,
    markers: markersByDate[cell.dateKey] || [],
    hoverPreview: previewByDate.get(cell.dateKey) || null,
  }));

  return {
    cells,
    markersByDate,
    hoverPreview: preview,
  };
}
