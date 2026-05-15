import { forwardRef, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { parseYmd, ymdFromParts } from "../../calendarDateUtils.js";
import AgendaRailShell from "../agenda/AgendaRailShell.jsx";
import MiniCalendar, { AgendaRailWithMiniCalendar } from "../agenda/MiniCalendar.jsx";
import EventsAgendaDeadlineRow from "./EventsAgendaDeadlineRow.jsx";
import { AllDayChip, TimedRow } from "./EventsAgendaEventRows.jsx";
import { AgendaSkeleton, WeatherHeader } from "./EventsAgendaRailParts.jsx";
import {
  buildEventsAgendaGroups,
  buildEventsMiniCalendarActivityItems,
} from "./eventsAgendaModel.js";

const EVENT_SCROLL_TOP_OFFSET = 44;

function keyForEvent(event, dateKey) {
  return `${event.agendaItemId || event.id}-${dateKey}`;
}

function isSelectedAgendaEvent(event, dateKey, selectedItemId, selectedDateKey) {
  return String(selectedItemId || "") === String(event.agendaItemId || "")
    && selectedDateKey === dateKey;
}

function previewSourceKey(item) {
  return `${item?.agendaItemId || item?.id || ""}:${item?.agendaDateKey || item?.dateKey || ""}`;
}

function previewItemForAgenda(item, kind) {
  const dateKey = item?.agendaDateKey || item?.dateKey || null;
  const preview = {
    ...item,
    kind,
    markerColor: item?.agendaSourceColor || item?.color,
    previewSourceKey: previewSourceKey(item),
  };
  if (kind === "event" && Number.isFinite(item?.startMs)) {
    return {
      ...preview,
      dateKey: undefined,
      agendaDateKey: undefined,
    };
  }
  return {
    ...preview,
    dateKey,
    agendaDateKey: dateKey,
  };
}

function groupDate(group) {
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
          ? "linear-gradient(180deg, rgba(203,166,218,0.16), rgba(203,166,218,0.08)), #1f1f24"
          : "#1f1f24",
        boxShadow: dropActive ? "inset 0 0 0 1px rgba(203,166,218,0.24)" : "none",
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
          ? "linear-gradient(180deg, rgba(203,166,218,0.18), rgba(203,166,218,0.09)), #23232a"
          : "#23232a";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = dropActive
          ? "linear-gradient(180deg, rgba(203,166,218,0.16), rgba(203,166,218,0.08)), #1f1f24"
          : "#1f1f24";
      }}
    >
      <span>{group.headerLabel}</span>
      <WeatherHeader weather={group.weather} />
    </button>
  );
}

const EventsAgendaRail = forwardRef(function EventsAgendaRail({
  viewYear,
  viewMonth,
  events = [],
  deadlineOverlay = null,
  weatherData = null,
  isLoading = false,
  entryScrollReady: entryScrollReadyProp = null,
  selectedDateKey,
  selectedItemId,
  scrollCommand = null,
  entryScrollTargetDateKey = null,
  currentYear,
  currentMonth,
  todayDate,
  canGoPrev = true,
  onPreviousMonth,
  onNextMonth,
  eventQuickActions,
  floatingEditorDirty = false,
  onDirtyBlocked,
  onPassiveDateChange,
  onDateAction,
  onMiniCalendarDateAction,
  onMiniCalendarDateCreate,
  onEventAction,
}, ref) {
  const todayKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const dragEventRef = useRef(null);
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  const [hoverPreviewItem, setHoverPreviewItem] = useState(null);
  const agenda = useMemo(() => buildEventsAgendaGroups({
    events,
    deadlineOverlay,
    viewYear,
    viewMonth,
    weatherData,
    todayKey,
    forceVisibleDateKey: entryScrollTargetDateKey || selectedDateKey,
  }), [deadlineOverlay, entryScrollTargetDateKey, events, selectedDateKey, todayKey, viewMonth, viewYear, weatherData]);
  const miniCalendarItems = useMemo(() => buildEventsMiniCalendarActivityItems({
    events,
    deadlineOverlay,
    viewYear,
    viewMonth,
  }), [deadlineOverlay, events, viewMonth, viewYear]);
  const readinessState = deadlineOverlay?.readiness?.state;
  const waitingForPlanningReadiness = ["idle", "loading", "slow"].includes(readinessState);
  const entryScrollReady = entryScrollReadyProp ?? !waitingForPlanningReadiness;
  const showAgendaSkeleton = !entryScrollReady || (isLoading && !agenda.visibleGroups.some((group) => group.hasEvents));

  const dirtyBlocked = () => {
    if (!floatingEditorDirty) return false;
    onDirtyBlocked?.();
    return true;
  };

  function handleDateAction(dateKey) {
    if (dirtyBlocked()) return;
    onDateAction?.(dateKey);
  }

  function handleEventSelect(event, element, anchorKind) {
    if (dirtyBlocked()) return;
    onEventAction?.({
      event,
      dateKey: event.agendaDateKey,
      anchorElement: element,
      sourceCellElement: element,
      anchorKind,
    });
  }

  function handleDeadlineSelect(deadline, element) {
    if (dirtyBlocked()) return;
    onEventAction?.({
      event: deadline,
      item: deadline,
      dateKey: deadline.agendaDateKey,
      anchorElement: element,
      sourceCellElement: element,
      anchorKind: "agenda-deadline-row",
      detailView: "deadlines",
    });
  }

  function startHoverPreview(item, kind) {
    setHoverPreviewItem(previewItemForAgenda(item, kind));
  }

  function endHoverPreview(item) {
    const sourceKey = previewSourceKey(item);
    setHoverPreviewItem((current) => (
      current?.previewSourceKey === sourceKey ? null : current
    ));
  }

  return (
    <AgendaRailWithMiniCalendar
      miniCalendar={(
        <MiniCalendar
          viewYear={viewYear}
          viewMonth={viewMonth}
          todayKey={todayKey}
          selectedDateKey={selectedDateKey}
          activityItems={miniCalendarItems}
          hoverPreviewItem={hoverPreviewItem}
          canGoPrev={canGoPrev}
          onPreviousMonth={onPreviousMonth}
          onNextMonth={onNextMonth}
          onDateAction={onMiniCalendarDateAction}
          onDateCreate={onMiniCalendarDateCreate}
        />
      )}
    >
      {showAgendaSkeleton ? (
        <AgendaSkeleton />
      ) : (
        <AgendaRailShell
          ref={ref}
          testId="events-agenda-rail"
          groups={agenda.visibleGroups}
          firstVisibleDateKey={agenda.firstVisibleDateKey}
          todayKey={todayKey}
          selectedDateKey={selectedDateKey}
          scrollCommand={scrollCommand}
          entryScrollTargetDateKey={entryScrollTargetDateKey}
          isLoading={isLoading}
          entryScrollReady={entryScrollReady}
          floatingEditorDirty={floatingEditorDirty}
          itemScrollTopOffset={EVENT_SCROLL_TOP_OFFSET}
          onPassiveDateChange={onPassiveDateChange}
          onDirtyBlocked={onDirtyBlocked}
          skeleton={<AgendaSkeleton />}
          showSkeleton={showAgendaSkeleton}
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
          renderHeader={({ group, registerHeader }) => (
            <AgendaHeader
              group={group}
              todayKey={todayKey}
              registerHeader={registerHeader}
              onActivate={handleDateAction}
              dropActive={eventQuickActions?.dropTargetDate === group.dateKey}
              quickActions={eventQuickActions}
            />
          )}
          renderGroup={({ group, registerRow, registerContent }) => {
            const expanded = expandedDays.has(group.dateKey);
            const visibleAllDay = expanded ? group.allDay : group.allDay.slice(0, 2);
            const hiddenAllDayCount = group.allDay.length - visibleAllDay.length;
            const showNoEvents = !group.hasEvents && (group.isFallback || selectedDateKey === group.dateKey || todayKey === group.dateKey);
            return (
              <>
                {group.allDay.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
                    {visibleAllDay.map((event) => (
                      <span
                        key={keyForEvent(event, group.dateKey)}
                        ref={(node) => registerRow(keyForEvent(event, group.dateKey), node, group.dateKey)}
                        style={{ minWidth: 0, maxWidth: "100%" }}
                        onDragStart={() => {
                          dragEventRef.current = event;
                        }}
                      >
                        <AllDayChip
                          event={event}
                          selected={isSelectedAgendaEvent(event, group.dateKey, selectedItemId, selectedDateKey)}
                          onSelect={handleEventSelect}
                          quickActions={eventQuickActions}
                          onDirtyBlocked={dirtyBlocked}
                          onPreviewStart={(item) => startHoverPreview(item, "event")}
                          onPreviewEnd={endHoverPreview}
                        />
                      </span>
                    ))}
                    {hiddenAllDayCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedDays((current) => {
                            const next = new Set(current);
                            next.add(group.dateKey);
                            return next;
                          });
                        }}
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
                    ref={(node) => registerRow(keyForEvent(event, group.dateKey), node, group.dateKey)}
                    onDragStart={() => {
                      dragEventRef.current = event;
                    }}
                  >
                    <TimedRow
                      event={event}
                      dateKey={group.dateKey}
                      todayKey={todayKey}
                      selected={isSelectedAgendaEvent(event, group.dateKey, selectedItemId, selectedDateKey)}
                      onSelect={handleEventSelect}
                      quickActions={eventQuickActions}
                      onDirtyBlocked={dirtyBlocked}
                      onPreviewStart={(item) => startHoverPreview(item, "event")}
                      onPreviewEnd={endHoverPreview}
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
                      registerRow={registerRow}
                      onSelect={handleDeadlineSelect}
                      onPreviewStart={(item) => startHoverPreview(item, "deadline")}
                      onPreviewEnd={endHoverPreview}
                    />
                  );
                })}
                {showNoEvents ? (
                  <div
                    ref={(node) => registerContent(group.dateKey, node)}
                    style={{
                      padding: "12px 10px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.055)",
                      background: "rgba(255,255,255,0.025)",
                      color: "rgba(205,214,244,0.64)",
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                  >
                    <div style={{ fontWeight: 650, color: "rgba(205,214,244,0.82)" }}>No Events</div>
                  </div>
                ) : null}
              </>
            );
          }}
        />
      )}
    </AgendaRailWithMiniCalendar>
  );
});

export default EventsAgendaRail;
