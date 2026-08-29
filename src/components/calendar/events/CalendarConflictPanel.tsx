import { AlertTriangle, CircleCheck } from "lucide-react";
import type { CSSProperties } from "react";
import type { CalendarDraftGhost } from "./CalendarDraftPreviewPanel";
import type { CalendarScheduleContextItem } from "../ghostPreview";
import { parseYmd } from "../calendarDateUtils";
import {
  buildConflictAgendaDays,
  selectConflictAgendaEntries,
  type ConflictAgendaDay,
  type ConflictAgendaTimedSegment,
} from "./calendarConflictAgendaModel";
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
const AGENDA_MIN_HEIGHT = 132;
const AGENDA_MAX_HEIGHT = 320;
const AGENDA_PIXELS_PER_MINUTE = 0.625;
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

function dateLabel(value: string) {
  const parsed = parseYmd(value);
  if (!parsed) return value;
  return pacificDate.format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12)));
}

function dateSpan(startDate: string, endDate: string) {
  const start = dateLabel(startDate);
  const end = dateLabel(endDate);
  return startDate === endDate ? start : `${start} – ${end}`;
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

function AgendaTimeRange({
  segment,
  day,
}: {
  segment: ConflictAgendaTimedSegment;
  day: ConflictAgendaDay;
}) {
  const start = segment.segmentStartMs === day.dayStartMs
    ? "Midnight"
    : pacificTime.format(new Date(segment.segmentStartMs));
  const end = segment.segmentEndMs === day.nextDayStartMs
    ? "Midnight"
    : pacificTime.format(new Date(segment.segmentEndMs));
  return (
    <span className="calendar-conflict-timeline__time" aria-label={`${start}–${end}`}>
      <span className="calendar-conflict-timeline__time-part">{start}–</span>
      <wbr />
      <span className="calendar-conflict-timeline__time-part">{end}</span>
    </span>
  );
}

function conflictTimeLabel({ startMs, endMs, startDate, endDate, allDay = false }: {
  startMs: number;
  endMs: number;
  startDate: string;
  endDate: string;
  allDay?: boolean;
}) {
  const start = new Date(startMs);
  const end = new Date(endMs);

  if (allDay) return `${dateSpan(startDate, endDate)} · All day`;
  return startDate === endDate
    ? `${pacificDate.format(start)} · ${timeRange(startMs, endMs)}`
    : `${pacificDate.format(start)}, ${pacificTime.format(start)} – ${pacificDate.format(end)}, ${pacificTime.format(end)}`;
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
              {conflictTimeLabel(conflict)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CalendarAllDayContext({ events }: { events: CalendarScheduleContextItem[] }) {
  if (!events.length) return null;
  return (
    <div className="calendar-conflict-panel__all-day" role="list" aria-label="All-day schedule context">
      <span className="calendar-conflict-panel__all-day-label">All day</span>
      <div className="calendar-conflict-panel__all-day-events">
        {events.map((event) => (
          <div
            key={`${event.id}-${event.startMs}`}
            className="calendar-conflict-panel__all-day-event"
            role="listitem"
            title={`${event.title} · ${conflictTimeLabel(event)}`}
          >
            <span
              className="calendar-conflict-panel__source-dot"
              style={{ "--calendar-conflict-color": event.color || "#89b4fa" } as CSSProperties}
              aria-hidden
            />
            <span className="calendar-conflict-panel__all-day-title">{event.title}</span>
            {event.startDate !== event.endDate ? (
              <span className="calendar-conflict-panel__all-day-range">{dateSpan(event.startDate, event.endDate)}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarDateContextList({ ghost }: CalendarConflictPanelProps) {
  const context = ghost.scheduleContext || [];
  const startDate = ghost.startDate || "";
  const endDate = ghost.endDate || startDate;
  const proposalTime = ghost.allDay
    ? `${dateSpan(startDate, endDate)} · All day`
    : conflictTimeLabel({
        startMs: ghost.startMs!,
        endMs: ghost.endMs!,
        startDate,
        endDate,
      });

  return (
    <div className="calendar-conflict-panel__list calendar-conflict-panel__list--dated" role="list">
      <div className="calendar-conflict-panel__event calendar-conflict-panel__event--proposal" role="listitem">
        <span
          className="calendar-conflict-panel__source-dot"
          style={{ "--calendar-conflict-color": ghost.color || "var(--ea-accent)" } as CSSProperties}
          aria-hidden
        />
        <span className="calendar-conflict-panel__copy">
          <span className="calendar-conflict-panel__event-title">{ghost.title || "Untitled event"}</span>
          <span className="calendar-conflict-panel__event-time">{proposalTime}</span>
        </span>
        <span className="calendar-conflict-panel__proposal-marker">Proposed</span>
      </div>
      {context.map((event) => (
        <div
          key={`${event.id}-${event.startMs}`}
          className="calendar-conflict-panel__event"
          data-conflict={event.conflicting ? "true" : undefined}
          role="listitem"
        >
          <span
            className="calendar-conflict-panel__source-dot"
            style={{ "--calendar-conflict-color": event.color || "#89b4fa" } as CSSProperties}
            aria-hidden
          />
          <span className="calendar-conflict-panel__copy">
            <span className="calendar-conflict-panel__event-title">{event.title}</span>
            <span className="calendar-conflict-panel__event-time">{conflictTimeLabel(event)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function agendaContextItem(
  scheduleContext: CalendarScheduleContextItem[],
  segment: Pick<ConflictAgendaTimedSegment, "sourceId" | "sourceStartMs">,
) {
  return scheduleContext.find((item) => (
    item.id === segment.sourceId && item.startMs === segment.sourceStartMs
  ));
}

function CalendarConflictAgendaDay({
  day,
  ghost,
}: {
  day: ConflictAgendaDay;
  ghost: CalendarDraftGhost;
}) {
  const scheduleContext = ghost.scheduleContext || [];
  const contextSegments = day.timedContext.flatMap((segment) => {
    const event = agendaContextItem(scheduleContext, segment);
    return event ? [{ segment, event }] : [];
  });
  const allDayEvents = day.allDayContext.flatMap((item) => {
    const event = scheduleContext.find((candidate) => (
      candidate.id === item.sourceId && candidate.startMs === item.sourceStartMs
    ));
    return event ? [event] : [];
  });
  const segments = [day.proposal, ...contextSegments.map(({ segment }) => segment)];
  let rangeStart = Math.max(
    day.dayStartMs,
    Math.min(...segments.map((segment) => segment.segmentStartMs)) - RANGE_PADDING,
  );
  let rangeEnd = Math.min(
    day.nextDayStartMs,
    Math.max(...segments.map((segment) => segment.segmentEndMs)) + RANGE_PADDING,
  );
  if (rangeEnd - rangeStart < 60 * MINUTE) {
    rangeEnd = Math.min(day.nextDayStartMs, rangeStart + 60 * MINUTE);
    rangeStart = Math.max(day.dayStartMs, rangeEnd - 60 * MINUTE);
  }
  const rangeDuration = rangeEnd - rangeStart;
  const baseTimelineHeight = Math.min(
    AGENDA_MAX_HEIGHT,
    Math.max(AGENDA_MIN_HEIGHT, (rangeDuration / MINUTE) * AGENDA_PIXELS_PER_MINUTE),
  );
  const position = (time: number) => ((time - rangeStart) / rangeDuration) * baseTimelineHeight;
  const blockGeometry = (segment: ConflictAgendaTimedSegment, minHeight: number) => ({
    top: position(segment.segmentStartMs),
    height: Math.max(minHeight, position(segment.segmentEndMs) - position(segment.segmentStartMs)),
  });
  const contextBlocks = contextSegments.map(({ segment, event }) => ({
    id: segment.segmentId,
    segment,
    event,
    ...blockGeometry(segment, EVENT_BLOCK_MIN_HEIGHT),
  }));
  const proposalBlock = {
    id: day.proposal.segmentId,
    segment: day.proposal,
    ...blockGeometry(day.proposal, DRAFT_BLOCK_MIN_HEIGHT),
    draft: true,
  };
  const timelineHeight = resolveConflictTimelineHeight(
    baseTimelineHeight,
    [...contextBlocks, proposalBlock],
    TIMELINE_BOTTOM_INSET,
  );
  const layoutById = new Map(layoutConflictTimelineItems([
    ...contextBlocks.map(({ id, top, height }) => ({ id, top, height })),
    proposalBlock,
  ]).map((item) => [item.id, item]));
  const proposalLayout = layoutById.get(proposalBlock.id)!;
  const dayStatus = day.proposal.continuesBefore
    ? day.proposal.continuesAfter ? "Continues" : "Ends"
    : day.proposal.continuesAfter ? "Starts" : "Proposed";

  return (
    <section className="calendar-conflict-agenda__day" aria-label={dateSpan(day.date, day.date)}>
      <div className="calendar-conflict-agenda__day-header">
        <span className="calendar-conflict-agenda__date">{dateSpan(day.date, day.date)}</span>
        <span className="calendar-conflict-agenda__day-status">{dayStatus}</span>
      </div>
      <CalendarAllDayContext events={allDayEvents} />
      <div
        className="calendar-conflict-timeline calendar-conflict-agenda__timeline"
        style={{ height: timelineHeight }}
        role="list"
        aria-label={`Agenda for ${dateSpan(day.date, day.date)}`}
      >
        <span className="calendar-conflict-timeline__axis" aria-hidden />
        <div className="calendar-conflict-timeline__lanes" role="presentation">
          {contextBlocks.map(({ id, segment, event, top, height }) => {
            const layout = layoutById.get(id)!;
            return (
              <div
                key={id}
                className={`calendar-conflict-timeline__block${event.conflicting ? " calendar-conflict-timeline__block--conflict" : ""}`}
                data-compact={layout.laneCount > 3 ? "true" : undefined}
                data-continues-before={segment.continuesBefore ? "true" : undefined}
                data-continues-after={segment.continuesAfter ? "true" : undefined}
                data-lane={layout.lane}
                style={{
                  top,
                  height,
                  "--calendar-conflict-color": event.color || "#89b4fa",
                  ...laneStyle(layout),
                } as CSSProperties}
                role="listitem"
                title={`${conflictTimeLabel(event)} · ${event.title}`}
              >
                <AgendaTimeRange segment={segment} day={day} />
                <span className="calendar-conflict-timeline__name">{event.title}</span>
              </div>
            );
          })}
          <div
            className="calendar-conflict-timeline__block calendar-conflict-timeline__block--draft"
            data-compact={proposalLayout.laneCount > 1 ? "true" : undefined}
            data-continues-before={day.proposal.continuesBefore ? "true" : undefined}
            data-continues-after={day.proposal.continuesAfter ? "true" : undefined}
            data-lane={proposalLayout.lane}
            style={{
              top: proposalBlock.top,
              height: proposalBlock.height,
              "--calendar-conflict-color": ghost.color || "var(--ea-accent)",
              ...laneStyle(proposalLayout),
            } as CSSProperties}
            role="listitem"
            title={`${timeRange(ghost.startMs!, ghost.endMs!)} · ${ghost.title || "Untitled event"}`}
          >
            <span className="calendar-conflict-timeline__marker">
              {day.proposal.continuesBefore ? "Continued" : "Proposed"}
            </span>
            <AgendaTimeRange segment={day.proposal} day={day} />
            <span className="calendar-conflict-timeline__name">{ghost.title || "Untitled event"}</span>
            {day.proposal.continuesAfter ? (
              <span className="calendar-conflict-agenda__continuation">Continues next day</span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function CalendarConflictAgenda({ ghost }: CalendarConflictPanelProps) {
  const days = buildConflictAgendaDays({
    proposal: { startMs: ghost.startMs!, endMs: ghost.endMs! },
    scheduleContext: ghost.scheduleContext || [],
  });
  const entries = selectConflictAgendaEntries(days);
  return (
    <div className="calendar-conflict-agenda" aria-label="Multi-day schedule around proposed event">
      {entries.map((entry) => entry.kind === "day" ? (
        <CalendarConflictAgendaDay key={entry.day.date} day={entry.day} ghost={ghost} />
      ) : (
        <div
          key={`${entry.startDate}-${entry.endDate}`}
          className="calendar-conflict-agenda__omitted"
          role="separator"
        >
          <span aria-hidden />
          {entry.count} day{entry.count === 1 ? "" : "s"} condensed
          <span aria-hidden />
        </div>
      ))}
    </div>
  );
}

function CalendarConflictTimeline({ ghost }: CalendarConflictPanelProps) {
  const draftStart = ghost.startMs!;
  const draftEnd = ghost.endMs!;
  const context = (ghost.scheduleContext || []).filter((event) => !event.allDay);
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
  const scheduleContext = ghost.scheduleContext || [];
  const allDayContext = scheduleContext.filter((event) => event.allDay);
  const showTimeline = !ghost.allDay
    && ghost.startMs != null
    && ghost.endMs != null
    && ghost.startDate === ghost.endDate;
  const showMultiDayAgenda = !ghost.allDay
    && ghost.startMs != null
    && ghost.endMs != null
    && ghost.startDate !== ghost.endDate;
  const summary = conflicts.length > 0
    ? `${conflicts.length} event${conflicts.length === 1 ? " overlaps" : "s overlap"} the proposed time.`
    : scheduleContext.length > 0
      ? ghost.allDay
        ? `${scheduleContext.length} other event${scheduleContext.length === 1 ? " is" : "s are"} scheduled across these dates.`
        : "No timed events overlap the proposed time."
      : ghost.allDay
        ? "Nothing else is scheduled across these dates."
        : "Nothing else is scheduled nearby.";

  return (
    <div className="calendar-conflict-panel" data-calendar-event-schedule-preview="true">
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
      {showTimeline ? (
        <>
          <CalendarAllDayContext events={allDayContext} />
          <CalendarConflictTimeline ghost={ghost} />
        </>
      ) : showMultiDayAgenda ? (
        <CalendarConflictAgenda ghost={ghost} />
      ) : ghost.allDay ? (
        <CalendarDateContextList ghost={ghost} />
      ) : (
        <CalendarConflictList ghost={ghost} />
      )}
    </div>
  );
}
