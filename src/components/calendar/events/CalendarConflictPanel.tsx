import { AlertTriangle, CircleCheck } from "lucide-react";
import type { CSSProperties } from "react";
import type { CalendarDraftGhost } from "./CalendarDraftPreviewPanel";
import {
  layoutConflictTimelineItems,
  resolveConflictTimelineHeight,
  type ConflictTimelineLayoutItem,
} from "./calendarConflictTimelineLayout";

interface CalendarConflictPanelProps {
  ghost: CalendarDraftGhost;
}

const MINUTE = 60_000;
const RANGE_PADDING = 15 * MINUTE;
const TIMELINE_BOTTOM_INSET = 12;
const EVENT_BLOCK_MIN_HEIGHT = 54;
const DRAFT_BLOCK_MIN_HEIGHT = 66;
const pacificDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const pacificTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

function timeRange(startMs: number, endMs: number) {
  return `${pacificTime.format(new Date(startMs))}–${pacificTime.format(new Date(endMs))}`;
}

function TimelineTimeRange({ startMs, endMs }: { startMs: number; endMs: number }) {
  const start = pacificTime.format(new Date(startMs));
  const end = pacificTime.format(new Date(endMs));
  return (
    <span className="calendar-conflict-timeline__time" aria-label={`${start}–${end}`}>
      <span className="calendar-conflict-timeline__time-part">{start}–</span>
      <wbr />
      <span className="calendar-conflict-timeline__time-part">{end}</span>
    </span>
  );
}

function conflictTimeLabel(startMs: number, endMs: number, allDay = false) {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const startDate = pacificDate.format(start);
  const endDate = pacificDate.format(end);

  if (allDay) {
    const inclusiveEndDate = pacificDate.format(new Date(endMs - 1));
    return startDate === inclusiveEndDate
      ? `${startDate} · All day`
      : `${startDate} – ${inclusiveEndDate} · All day`;
  }
  return startDate === endDate
    ? `${startDate} · ${timeRange(startMs, endMs)}`
    : `${startDate}, ${pacificTime.format(start)} – ${endDate}, ${pacificTime.format(end)}`;
}

function laneStyle({ lane, laneCount }: ConflictTimelineLayoutItem): CSSProperties {
  if (laneCount <= 1) return { left: 0, right: 0 };
  const leftPercent = (lane / laneCount) * 100;
  const rightPercent = ((laneCount - lane - 1) / laneCount) * 100;
  return {
    left: `calc(${leftPercent}% + ${lane === 0 ? 0 : 3}px)`,
    right: `calc(${rightPercent}% + ${lane === laneCount - 1 ? 0 : 3}px)`,
  };
}

function CalendarConflictList({ ghost }: CalendarConflictPanelProps) {
  return (
    <div className="calendar-conflict-panel__list" role="list">
      {(ghost.conflicts || []).map((conflict) => (
        <div key={`${conflict.id}-${conflict.startMs}`} className="calendar-conflict-panel__event" role="listitem">
          <span
            className="calendar-conflict-panel__source-dot"
            style={{ "--calendar-conflict-color": conflict.color || "#89b4fa" } as CSSProperties}
            aria-hidden
          />
          <span className="calendar-conflict-panel__copy">
            <span className="calendar-conflict-panel__event-title">{conflict.title}</span>
            <span className="calendar-conflict-panel__event-time">
              {conflictTimeLabel(conflict.startMs, conflict.endMs, conflict.allDay)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CalendarConflictTimeline({ ghost }: CalendarConflictPanelProps) {
  const draftStart = ghost.startMs!;
  const draftEnd = ghost.endMs!;
  const context = ghost.scheduleContext || [];
  const rangeStart = Math.min(draftStart, ...context.map((event) => event.startMs)) - RANGE_PADDING;
  const rangeEnd = Math.max(draftEnd, ...context.map((event) => event.endMs)) + RANGE_PADDING;
  const rangeDuration = Math.max(rangeEnd - rangeStart, 60 * MINUTE);
  const baseTimelineHeight = Math.min(360, Math.max(220, rangeDuration / MINUTE));
  const position = (time: number) => ((time - rangeStart) / rangeDuration) * baseTimelineHeight;
  const blockGeometry = (startMs: number, endMs: number, minHeight: number) => ({
    top: position(startMs),
    height: Math.max(minHeight, position(endMs) - position(startMs)),
  });
  const contextBlocks = context.map((event) => ({
    id: `context-${event.id}-${event.startMs}`,
    event,
    ...blockGeometry(event.startMs, event.endMs, EVENT_BLOCK_MIN_HEIGHT),
  }));
  const draftBlock = {
    id: "draft",
    ...blockGeometry(draftStart, draftEnd, DRAFT_BLOCK_MIN_HEIGHT),
    draft: true,
  };
  const timelineHeight = resolveConflictTimelineHeight(
    baseTimelineHeight,
    [...contextBlocks, draftBlock],
    TIMELINE_BOTTOM_INSET,
  );
  const layoutById = new Map(layoutConflictTimelineItems([
    ...contextBlocks.map(({ id, top, height }) => ({ id, top, height })),
    draftBlock,
  ]).map((item) => [item.id, item]));
  const draftLayout = layoutById.get(draftBlock.id)!;
  const draftStyle = {
    top: draftBlock.top,
    height: draftBlock.height,
    "--calendar-conflict-color": ghost.color || "var(--ea-accent)",
    ...laneStyle(draftLayout),
  } as CSSProperties;

  return (
    <div
      className="calendar-conflict-timeline"
      style={{ height: timelineHeight }}
      role="list"
      aria-label="Schedule around proposed event"
    >
      <span className="calendar-conflict-timeline__axis" aria-hidden />
      <div className="calendar-conflict-timeline__lanes" role="presentation">
        {contextBlocks.map(({ id, event, top, height }) => {
          const layout = layoutById.get(id)!;
          const style = {
            top,
            height,
            "--calendar-conflict-color": event.color || "#89b4fa",
            ...laneStyle(layout),
          } as CSSProperties;
          return (
            <div
              key={id}
              className={`calendar-conflict-timeline__block${event.conflicting ? " calendar-conflict-timeline__block--conflict" : ""}`}
              data-compact={layout.laneCount > 3 ? "true" : undefined}
              data-lane={layout.lane}
              style={style}
              role="listitem"
              title={`${timeRange(event.startMs, event.endMs)} · ${event.title}`}
            >
              <TimelineTimeRange startMs={event.startMs} endMs={event.endMs} />
              <span className="calendar-conflict-timeline__name">{event.title}</span>
            </div>
          );
        })}
        <div
          className="calendar-conflict-timeline__block calendar-conflict-timeline__block--draft"
          data-compact={draftLayout.laneCount > 1 ? "true" : undefined}
          data-lane={draftLayout.lane}
          style={draftStyle}
          role="listitem"
          title={`${timeRange(draftStart, draftEnd)} · ${ghost.title || "Untitled event"}`}
        >
          <span className="calendar-conflict-timeline__marker">Proposed</span>
          <TimelineTimeRange startMs={draftStart} endMs={draftEnd} />
          <span className="calendar-conflict-timeline__name">{ghost.title || "Untitled event"}</span>
        </div>
      </div>
    </div>
  );
}

export default function CalendarConflictPanel({ ghost }: CalendarConflictPanelProps) {
  const conflicts = ghost.conflicts || [];
  const showTimeline = !ghost.allDay
    && ghost.startMs != null
    && ghost.endMs != null;
  const summary = conflicts.length > 0
    ? `${conflicts.length} event${conflicts.length === 1 ? " overlaps" : "s overlap"} the proposed time.`
    : (ghost.scheduleContext?.length || 0) > 0
      ? "No events overlap the proposed time."
      : "Nothing else is scheduled nearby.";

  return (
    <div className="calendar-conflict-panel">
      <div className="calendar-conflict-panel__header">
        <span
          className="calendar-conflict-panel__icon"
          data-conflict={conflicts.length > 0}
          aria-hidden
        >
          {conflicts.length > 0 ? <AlertTriangle size={15} /> : <CircleCheck size={15} />}
        </span>
        <span>
          <span className="calendar-conflict-panel__title">Schedule around this event</span>
          <span className="calendar-conflict-panel__summary">{summary}</span>
        </span>
      </div>
      {showTimeline ? <CalendarConflictTimeline ghost={ghost} /> : <CalendarConflictList ghost={ghost} />}
    </div>
  );
}
