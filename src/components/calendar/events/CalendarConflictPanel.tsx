import { AlertTriangle, CircleCheck } from "lucide-react";
import type { CSSProperties } from "react";
import type { CalendarDraftGhost } from "./CalendarDraftPreviewPanel";

interface CalendarConflictPanelProps {
  ghost: CalendarDraftGhost;
}

const MINUTE = 60_000;
const RANGE_PADDING = 15 * MINUTE;
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
  const timelineHeight = Math.min(360, Math.max(220, rangeDuration / MINUTE));
  const position = (time: number) => ((time - rangeStart) / rangeDuration) * timelineHeight;
  const blockHeight = (startMs: number, endMs: number) => Math.max(42, position(endMs) - position(startMs));
  const draftStyle = {
    top: position(draftStart),
    height: blockHeight(draftStart, draftEnd),
    "--calendar-conflict-color": ghost.color || "var(--ea-accent)",
  } as CSSProperties;

  return (
    <div
      className="calendar-conflict-timeline"
      style={{ height: timelineHeight }}
      role="list"
      aria-label="Schedule around proposed event"
    >
      <span className="calendar-conflict-timeline__axis" aria-hidden />
      {context.map((event) => {
        const style = {
          top: position(event.startMs),
          height: blockHeight(event.startMs, event.endMs),
          "--calendar-conflict-color": event.color || "#89b4fa",
        } as CSSProperties;
        return (
          <div
            key={`${event.id}-${event.startMs}`}
            className={`calendar-conflict-timeline__block${event.conflicting ? " calendar-conflict-timeline__block--conflict" : ""}`}
            style={style}
            role="listitem"
          >
            <span className="calendar-conflict-timeline__time">{timeRange(event.startMs, event.endMs)}</span>
            <span className="calendar-conflict-timeline__name">{event.title}</span>
          </div>
        );
      })}
      <div
        className={`calendar-conflict-timeline__block calendar-conflict-timeline__block--draft${(ghost.conflicts?.length || 0) === 0 ? " calendar-conflict-timeline__block--draft-clear" : ""}`}
        style={draftStyle}
        role="listitem"
      >
        <span className="calendar-conflict-timeline__marker">Proposed</span>
        <span className="calendar-conflict-timeline__time">{timeRange(draftStart, draftEnd)}</span>
        <span className="calendar-conflict-timeline__name">{ghost.title || "Untitled event"}</span>
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
