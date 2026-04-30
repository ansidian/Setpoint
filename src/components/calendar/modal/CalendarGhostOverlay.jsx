import { addDaysYmd } from "../calendarDateUtils.js";
import { formatTime12FromTime24, ghostSpanDays } from "../ghostPreview.js";

function buildDateIndex(monthCells) {
  const map = new Map();
  monthCells.forEach((cell, index) => {
    map.set(cell.dateKey, {
      index,
      row: Math.floor(index / 7) + 1,
      column: (index % 7) + 1,
    });
  });
  return map;
}

function buildSegmentsForGhost(ghost, monthCells) {
  const dateIndex = buildDateIndex(monthCells);
  const visibleDates = monthCells.map((cell) => cell.dateKey);
  const firstVisible = visibleDates[0];
  const lastVisible = visibleDates[visibleDates.length - 1];
  const start = ghost.startDate < firstVisible ? firstVisible : ghost.startDate;
  const end = ghost.endDate > lastVisible ? lastVisible : ghost.endDate;
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
      id: `${ghost.id}-${cursor}-${segmentEnd}`,
      ghost,
      row: startPos.row,
      columnStart: startPos.column,
      columnEnd: endPos.column + 1,
      startsBeforeVisible: ghost.startDate < cursor,
      endsAfterVisible: ghost.endDate > segmentEnd,
      segmentStart: cursor,
      segmentEnd,
    });
    cursor = addDaysYmd(segmentEnd, 1);
  }

  return segments;
}

function ghostLabel(ghost) {
  return ghost.title;
}

function segmentStyle(segment, layout, lane) {
  const ghost = segment.ghost;
  const color = ghost.color || "var(--ea-accent)";
  const rowTop = (layout?.tier === "uhd" || layout?.tier === "xl") ? 32 : 30;
  const height = (layout?.tier === "uhd" || layout?.tier === "xl" || layout?.tier === "lg") ? 30 : 28;
  const laneGap = height + 4;
  const spanDays = ghostSpanDays(ghost);
  const isMultiDayEvent = ghost.kind === "event" && spanDays > 0;

  return {
    gridRow: segment.row,
    gridColumn: `${segment.columnStart} / ${segment.columnEnd}`,
    alignSelf: "start",
    margin: `${rowTop + lane * laneGap}px 7px 0`,
    height,
    minWidth: 0,
    borderRadius: isMultiDayEvent ? 9 : 8,
    border: `1px dotted color-mix(in srgb, ${color} 54%, transparent)`,
    background: "rgba(255,255,255,0.03)",
    color: "#f5f7ff",
    boxShadow: "none",
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "center",
    gap: 6,
    padding: "0 9px",
    pointerEvents: "none",
    opacity: 0.96,
    zIndex: 6 + lane,
    overflow: "hidden",
    fontFamily: "inherit",
  };
}

function GhostSegment({ segment, layout, lane }) {
  const ghost = segment.ghost;
  const continuationStart = segment.startsBeforeVisible ? "<" : "";
  const label = ghostLabel(ghost);
  const leadingLabel = continuationStart || (ghost.allDay ? "All day" : formatTime12FromTime24(ghost.startTime));

  return (
    <div
      data-testid="calendar-ghost-chip"
      data-ghost-kind={ghost.kind}
      data-ghost-start={ghost.startDate}
      data-ghost-end={ghost.endDate}
      aria-hidden="true"
      style={segmentStyle(segment, layout, lane)}
    >
      <span
        style={{
          fontSize: 9,
          lineHeight: 1,
          fontWeight: 800,
          letterSpacing: 0.4,
          color: ghost.color || "var(--ea-accent)",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {leadingLabel}
      </span>
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.1,
        }}
      >
        {label}
      </span>
    </div>
  );
}

export default function CalendarGhostOverlay({
  ghostPreview,
  monthCells,
  layout,
  gridRowCount,
  fillGridHeight,
}) {
  const ghosts = (ghostPreview?.ghosts || []).filter((ghost) => (
    ghost.kind === "event" && ghostSpanDays(ghost) > 0
  ));
  if (!ghosts.length) return null;

  const segments = ghosts.flatMap((ghost, index) => (
    buildSegmentsForGhost({ ...ghost, lane: index }, monthCells)
      .map((segment) => ({ ...segment, lane: Math.min(index, 2) }))
  ));
  if (!segments.length) return null;

  return (
    <div
      data-testid="calendar-ghost-overlay"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gridTemplateRows: fillGridHeight
          ? `repeat(${gridRowCount}, minmax(0, 1fr))`
          : `repeat(6, ${layout.cellHeight}px)`,
        gap: layout.gridGap,
        pointerEvents: "none",
        zIndex: 7,
      }}
    >
      {segments.map((segment) => (
        <GhostSegment
          key={segment.id}
          segment={segment}
          layout={layout}
          lane={segment.lane}
        />
      ))}
    </div>
  );
}
