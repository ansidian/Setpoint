import { memo } from "react";
import type { MutableRefObject } from "react";
import { ChevronDown } from "lucide-react";
import { parseYmd } from "../../calendarDateUtils.ts";
import AgendaRailShell from "../agenda/AgendaRailShell.tsx";
import type { AgendaRegistrationCallbacks } from "../agenda/AgendaMonthScrollContainer.tsx";
import EventsAgendaDeadlineRow from "./EventsAgendaDeadlineRow.tsx";
import { AllDayChip, TimedRow } from "./EventsAgendaEventRows.tsx";
import type { EventsAgendaQuickActions } from "./EventsAgendaEventRows.tsx";
import { EmptyEventDay, WeatherHeader } from "./EventsAgendaRailParts.tsx";
import { agendaHasSelectedHiddenAllDay } from "./eventsAgendaModel.ts";
import type {
  AgendaDeadline,
  AgendaEvent,
  EventsAgendaGroup,
  EventsAgendaMonthResult,
} from "./eventsAgendaModel.ts";
import type { CalendarItemLike } from "../calendarViewTypes.ts";

export interface EventsAgendaRailQuickActions extends EventsAgendaQuickActions {
  draggingEventId?: string | null;
  dropTargetDate?: string | null;
  enterDropTarget?: (dateKey: string) => void;
  leaveDropTarget?: (dateKey: string) => void;
  dropEvent?: (input: { event: AgendaEvent | null; targetDate: string; anchorRect: DOMRect }) => void;
}

export type PreviewKind = "event" | "deadline";
export type AgendaSelectAnchorKind = "agenda-chip" | "agenda-row";

function keyForEvent(event: AgendaEvent, dateKey: string): string {
  return `${event.agendaItemId || event.id}-${dateKey}`;
}

function isSelectedAgendaEvent(
  event: AgendaEvent,
  dateKey: string,
  selectedItemId: unknown,
  selectedDateKey?: string | null,
): boolean {
  return String(selectedItemId || "") === String(event.agendaItemId || "")
    && selectedDateKey === dateKey;
}

function groupDate(group: Pick<EventsAgendaGroup, "dateKey">): Date | null {
  const parsed = parseYmd(group.dateKey);
  return parsed ? new Date(parsed.year, parsed.month, parsed.day) : null;
}

function AgendaHeader({
  group,
  todayKey,
  onActivate,
  registerHeader,
  dropActive,
  quickActions,
}: {
  group: EventsAgendaGroup;
  todayKey: string;
  onActivate: (dateKey: string) => void;
  registerHeader: (dateKey: string, node: HTMLElement | null) => void;
  dropActive: boolean;
  quickActions?: EventsAgendaRailQuickActions | null;
}) {
  const date = groupDate(group);
  return (
    <button
      type="button"
      ref={(node) => registerHeader(group.dateKey, node)}
      data-agenda-date-header="true"
      data-date-key={group.dateKey}
      aria-label={`Select ${date ? date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : group.dateKey}`}
      onClick={() => onActivate(group.dateKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(group.dateKey);
        }
      }}
      onDragEnter={() => quickActions?.enterDropTarget?.(group.dateKey)}
      onDragOver={(event) => {
        if (!quickActions?.draggingEventId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={() => quickActions?.leaveDropTarget?.(group.dateKey)}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 4,
        width: "calc(100% + 20px)",
        margin: "0 -10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        minHeight: 34,
        padding: "8px 10px 7px",
        border: "0",
        borderRadius: 0,
        background: dropActive
          ? "linear-gradient(180deg, color-mix(in srgb, var(--sp-accent) 16%, transparent), color-mix(in srgb, var(--sp-accent) 8%, transparent)), var(--sp-panel)"
          : "var(--sp-panel)",
        boxShadow: dropActive ? "inset 0 0 0 1px color-mix(in srgb, var(--sp-accent) 24%, transparent)" : "none",
        color: group.dateKey === todayKey ? "#0495FF" : "#B1B1B3",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 1.35,
        lineHeight: 1,
        textAlign: "left",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "background-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = dropActive
          ? "linear-gradient(180deg, color-mix(in srgb, var(--sp-accent) 18%, transparent), color-mix(in srgb, var(--sp-accent) 9%, transparent)), var(--sp-panel)"
          : "var(--sp-panel)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = dropActive
          ? "linear-gradient(180deg, color-mix(in srgb, var(--sp-accent) 16%, transparent), color-mix(in srgb, var(--sp-accent) 8%, transparent)), var(--sp-panel)"
          : "var(--sp-panel)";
      }}
    >
      <span>{group.headerLabel}</span>
      <WeatherHeader weather={group.weather} />
    </button>
  );
}

interface EventsAgendaMonthSectionProps extends AgendaRegistrationCallbacks {
  month: EventsAgendaMonthResult;
  todayKey: string;
  selectedDateKey?: string | null;
  selectedItemId?: unknown;
  eventQuickActions?: EventsAgendaRailQuickActions | null;
  expandedDays: Set<string>;
  onExpandDay: (dateKey: string) => void;
  onDateAction: (dateKey: string) => void;
  onEventSelect: (event: AgendaEvent, element: HTMLElement, anchorKind: AgendaSelectAnchorKind) => void;
  onDeadlineSelect: (deadline: AgendaDeadline, element: HTMLElement) => void;
  onDirtyBlocked: () => boolean;
  onPreviewStart: (item: CalendarItemLike, kind: PreviewKind) => void;
  onPreviewEnd: (item: CalendarItemLike) => void;
  dragEventRef: MutableRefObject<AgendaEvent | null>;
  mobileAgenda: boolean;
}

// Month sections bail out of re-rendering whenever their month's group
// object identity is unchanged (reuseMultiMonthAgendaGroups) and the shared
// props are stable — only the months a batch actually touched re-render.
const EventsAgendaMonthSection = memo(function EventsAgendaMonthSection({
  month,
  registerHeader,
  registerSection,
  registerRow,
  registerContent,
  todayKey,
  selectedDateKey,
  selectedItemId,
  eventQuickActions,
  expandedDays,
  onExpandDay,
  onDateAction,
  onEventSelect,
  onDeadlineSelect,
  onDirtyBlocked,
  onPreviewStart,
  onPreviewEnd,
  dragEventRef,
  mobileAgenda,
}: EventsAgendaMonthSectionProps) {
  return (
    <AgendaRailShell
      groups={month.visibleGroups}
      registerHeader={registerHeader}
      registerSection={registerSection}
      registerRow={registerRow}
      registerContent={registerContent}
      getSectionProps={(group) => ({
        onDragEnter: () => eventQuickActions?.enterDropTarget?.(group.dateKey),
        onDragOver: (event) => {
          if (!eventQuickActions?.draggingEventId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        },
        onDragLeave: () => eventQuickActions?.leaveDropTarget?.(group.dateKey),
        onDrop: (dropEvent) => {
          if (!eventQuickActions?.draggingEventId) return;
          dropEvent.preventDefault();
          eventQuickActions.dropEvent?.({
            event: dragEventRef.current,
            targetDate: group.dateKey,
            anchorRect: dropEvent.currentTarget.getBoundingClientRect(),
          });
        },
      })}
      renderHeader={({ group, registerHeader: registerGroupHeader }) => (
        <AgendaHeader
          group={group}
          todayKey={todayKey}
          registerHeader={registerGroupHeader}
          onActivate={onDateAction}
          dropActive={eventQuickActions?.dropTargetDate === group.dateKey}
          quickActions={eventQuickActions}
        />
      )}
      renderGroup={({ group, registerRow: registerGroupRow, registerContent: registerGroupContent }) => {
        // Auto-expand (without persisting) when the selected item is a hidden
        // all-day chip, so it renders and registers its row ref for highlight/scroll.
        const expanded = expandedDays.has(group.dateKey)
          || agendaHasSelectedHiddenAllDay(group, 2, selectedItemId, selectedDateKey);
        const visibleAllDay = expanded ? group.allDay : group.allDay.slice(0, 2);
        const hiddenAllDayCount = group.allDay.length - visibleAllDay.length;
        const showNoEvents = !group.hasEvents
          && (group.isFallback || selectedDateKey === group.dateKey || todayKey === group.dateKey);
        return (
          <>
            {group.allDay.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
                {visibleAllDay.map((event) => (
                  <span
                    key={keyForEvent(event, group.dateKey)}
                    ref={(node) => registerGroupRow(keyForEvent(event, group.dateKey), node, group.dateKey)}
                    style={{ minWidth: 0, maxWidth: "100%" }}
                    onDragStart={() => {
                      dragEventRef.current = event;
                    }}
                  >
                    <AllDayChip
                      event={event}
                      selected={isSelectedAgendaEvent(event, group.dateKey, selectedItemId, selectedDateKey)}
                      onSelect={onEventSelect}
                      quickActions={eventQuickActions}
                      onDirtyBlocked={onDirtyBlocked}
                      onPreviewStart={(item) => onPreviewStart(item, "event")}
                      onPreviewEnd={onPreviewEnd}
                    />
                  </span>
                ))}
                {hiddenAllDayCount > 0 ? (
                  <button
                    type="button"
                    className="sp-agenda-touch sp-mobile-agenda-control"
                    onClick={() => onExpandDay(group.dateKey)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      minHeight: 24,
                      padding: "4px 8px",
                      borderRadius: 7,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.035)",
                      color: "rgba(205,214,244,0.74)",
                      fontSize: 11,
                      fontWeight: 750,
                      cursor: "pointer",
                    }}
                  >
                    +{hiddenAllDayCount}
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {group.timed.map((event) => (
              <span
                key={keyForEvent(event, group.dateKey)}
                ref={(node) => registerGroupRow(keyForEvent(event, group.dateKey), node, group.dateKey)}
                onDragStart={() => {
                  dragEventRef.current = event;
                }}
              >
                <TimedRow
                  event={event}
                  dateKey={group.dateKey}
                  todayKey={todayKey}
                  selected={isSelectedAgendaEvent(event, group.dateKey, selectedItemId, selectedDateKey)}
                  onSelect={onEventSelect}
                  quickActions={eventQuickActions}
                  onDirtyBlocked={onDirtyBlocked}
                  onPreviewStart={(item) => onPreviewStart(item, "event")}
                  onPreviewEnd={onPreviewEnd}
                />
              </span>
            ))}
            {group.deadlines.map((deadline) => {
              const selected = String(selectedItemId || "") === String(deadline.agendaItemId || "")
                && selectedDateKey === group.dateKey;
              return (
                <EventsAgendaDeadlineRow
                  key={`deadline-${deadline.agendaItemId}-${group.dateKey}`}
                  deadline={deadline}
                  dateKey={group.dateKey}
                  selected={selected}
                  registerRow={registerGroupRow}
                  onSelect={onDeadlineSelect}
                  onPreviewStart={(item) => onPreviewStart(item, "deadline")}
                  onPreviewEnd={onPreviewEnd}
                />
              );
            })}
            {showNoEvents ? (
              <EmptyEventDay
                contentRef={(node) => registerGroupContent(group.dateKey, node)}
                fallback={group.isFallback}
                mobileAgenda={mobileAgenda}
                monthName={groupDate(group)?.toLocaleDateString("en-US", { month: "long" }) || "this month"}
              />
            ) : null}
          </>
        );
      }}
    />
  );
});

export default EventsAgendaMonthSection;
