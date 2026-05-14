import {
  addDaysYmd,
  pacificTime24,
  pacificYMD,
} from "../calendarDateUtils.js";
import { formatTime12FromTime24 } from "../ghostPreview.js";
import { getEventSelectionId } from "../../../lib/redesign-helpers";

function localDateFromMs(ms) {
  return Number.isFinite(ms) ? pacificYMD(ms) : null;
}

function eventTitle(item) {
  return String(item?.title || "").trim() || "(No title)";
}

function comparePinnedItems(a, b) {
  const aItem = a.item || {};
  const bItem = b.item || {};
  const aAllDay = !!aItem.allDay;
  const bAllDay = !!bItem.allDay;
  if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
  if ((aItem.startMs || 0) !== (bItem.startMs || 0)) return (aItem.startMs || 0) - (bItem.startMs || 0);
  return eventTitle(aItem).localeCompare(eventTitle(bItem));
}

function normalizeRange(startDate, endDate) {
  if (!startDate || !endDate) return null;
  if (endDate < startDate) return { startDate, endDate: startDate };
  return { startDate, endDate };
}

export function visualEventDateRange(event) {
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

  if (event.endMs > event.startMs && pacificTime24(event.endMs) === "00:00") {
    endDate = addDaysYmd(endDate, -1);
  }

  return normalizeRange(startDate, endDate);
}

function visualGhostDateRange(ghost) {
  if (!ghost?.startDate || !ghost?.endDate) return null;
  return normalizeRange(ghost.startDate, ghost.endDate);
}

export function isPinnedCalendarEvent(event) {
  const range = visualEventDateRange(event);
  if (!range) return false;
  return !!event?.allDay || range.startDate !== range.endDate;
}

export function isPinnedCalendarGhost(ghost) {
  const range = visualGhostDateRange(ghost);
  if (!range) return false;
  return !!ghost?.allDay || range.startDate !== range.endDate;
}

function eventSpanId(event) {
  return getEventSelectionId(event);
}

function ghostSpanId(ghost) {
  return String(ghost?.id || `ghost-${ghost?.startDate || "date"}-${eventTitle(ghost)}`);
}

function toCandidate(item, kind) {
  const range = kind === "event" ? visualEventDateRange(item) : visualGhostDateRange(item);
  if (!range) return null;

  const id = kind === "event" ? eventSpanId(item) : ghostSpanId(item);
  if (!id) return null;

  return {
    id: `${kind}:${id}`,
    eventId: kind === "event" ? String(id) : null,
    kind,
    item,
    startDate: range.startDate,
    endDate: range.endDate,
    interactive: kind === "event",
    readOnly: kind === "event"
      ? item?.writable === false || (!!item?.eventType && item.eventType !== "default")
      : true,
  };
}

function buildDateIndex(monthCells) {
  const index = new Map();
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

function splitCandidateByRows(candidate, dateIndex, firstVisible, lastVisible) {
  const start = candidate.startDate < firstVisible ? firstVisible : candidate.startDate;
  const end = candidate.endDate > lastVisible ? lastVisible : candidate.endDate;
  if (!start || !end || end < start) return [];

  const segments = [];
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
      startsBeforeSegment: candidate.startDate < cursor,
      endsAfterSegment: candidate.endDate > segmentEnd,
      interactive: candidate.interactive,
      readOnly: candidate.readOnly,
    });
    cursor = addDaysYmd(segmentEnd, 1);
  }

  return segments;
}

function segmentDates(segment) {
  const dates = [];
  let cursor = segment.segmentStart;
  while (cursor <= segment.segmentEnd) {
    dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return dates;
}

function laneIsFree(rowLanes, lane, segment) {
  const occupied = rowLanes.get(lane);
  if (!occupied) return true;
  return segmentDates(segment).every((date) => !occupied.has(date));
}

function occupyLane(rowLanes, lane, segment) {
  let occupied = rowLanes.get(lane);
  if (!occupied) {
    occupied = new Set();
    rowLanes.set(lane, occupied);
  }
  segmentDates(segment).forEach((date) => occupied.add(date));
}

function firstFreeLane(rowLanes, segment, preferredLane = null) {
  if (Number.isFinite(preferredLane) && laneIsFree(rowLanes, preferredLane, segment)) {
    return preferredLane;
  }
  for (let lane = 0; lane < 12; lane += 1) {
    if (laneIsFree(rowLanes, lane, segment)) return lane;
  }
  return rowLanes.size;
}

function itemLeadingLabel(segment) {
  const item = segment.item || {};
  if (segment.startsBeforeSegment) return "<";
  if (item.allDay) return "All day";
  if (segment.kind === "ghost") return formatTime12FromTime24(item.startTime);
  return Number.isFinite(item.startMs)
    ? new Date(item.startMs).toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";
}

export function spanSegmentDisplay(segment) {
  return {
    title: eventTitle(segment?.item),
    leadingLabel: itemLeadingLabel(segment),
    recurring: !!segment?.item?.isRecurring || !!segment?.item?.recurring,
    color: segment?.item?.color || segment?.item?.sourceColor || "#89b4fa",
  };
}

export function eventVisuallyOverlapsRange(event, startDate, endDate) {
  const range = visualEventDateRange(event);
  return !!range && range.startDate <= endDate && range.endDate >= startDate;
}

export function calendarEventTouchedMonths(event) {
  const range = visualEventDateRange(event);
  if (!range) return [];
  const months = [];
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
} = {}) {
  const dateIndex = buildDateIndex(monthCells);
  const visibleDates = (monthCells || []).map((cell) => cell?.dateKey).filter(Boolean);
  const firstVisible = visibleDates[0];
  const lastVisible = visibleDates[visibleDates.length - 1];
  const pinnedByDate = {};
  const reservedLaneCountByDate = {};
  const pinnedGhostCountByDate = {};
  const pinnedIds = new Set();

  if (!firstVisible || !lastVisible) {
    return { spanSegments: [], pinnedByDate, reservedLaneCountByDate, pinnedGhostCountByDate, pinnedIds };
  }

  const eventCandidates = (events || [])
    .filter(isPinnedCalendarEvent)
    .map((event) => toCandidate(event, "event"))
    .filter(Boolean);
  const ghostCandidates = (ghosts || [])
    .filter((ghost) => ghost?.kind === "event" && isPinnedCalendarGhost(ghost))
    .map((ghost) => toCandidate(ghost, "ghost"))
    .filter(Boolean);
  const candidates = [...eventCandidates, ...ghostCandidates]
    .filter((candidate) => candidate.startDate <= lastVisible && candidate.endDate >= firstVisible)
    .sort(comparePinnedItems);

  for (const candidate of candidates) {
    let cursor = candidate.startDate < firstVisible ? firstVisible : candidate.startDate;
    const end = candidate.endDate > lastVisible ? lastVisible : candidate.endDate;
    while (cursor <= end) {
      if (dateIndex.has(cursor)) {
        if (!pinnedByDate[cursor]) pinnedByDate[cursor] = [];
        pinnedByDate[cursor].push(candidate.item);
        if (candidate.kind === "ghost") {
          pinnedGhostCountByDate[cursor] = (pinnedGhostCountByDate[cursor] || 0) + 1;
        }
      }
      cursor = addDaysYmd(cursor, 1);
    }
    if (candidate.kind === "event" && candidate.eventId) pinnedIds.add(candidate.eventId);
  }

  const rowLanesByRow = new Map();
  const preferredLaneByCandidate = new Map();
  const spanSegments = [];

  for (const candidate of candidates) {
    const candidateSegments = splitCandidateByRows(candidate, dateIndex, firstVisible, lastVisible);
    for (const segment of candidateSegments) {
      let rowLanes = rowLanesByRow.get(segment.row);
      if (!rowLanes) {
        rowLanes = new Map();
        rowLanesByRow.set(segment.row, rowLanes);
      }
      const preferredLane = preferredLaneByCandidate.get(candidate.id);
      const lane = firstFreeLane(rowLanes, segment, preferredLane);
      preferredLaneByCandidate.set(candidate.id, lane);
      occupyLane(rowLanes, lane, segment);
      const nextSegment = { ...segment, lane };
      segmentDates(nextSegment).forEach((date) => {
        reservedLaneCountByDate[date] = Math.max(reservedLaneCountByDate[date] || 0, lane + 1);
      });
      spanSegments.push(nextSegment);
    }
  }

  return {
    spanSegments,
    pinnedByDate,
    reservedLaneCountByDate,
    pinnedGhostCountByDate,
    pinnedIds,
  };
}
