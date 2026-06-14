import { forwardRef, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { parseYmd, ymdFromParts } from "../../calendarDateUtils.js";
import AgendaMonthScrollContainer from "../agenda/AgendaMonthScrollContainer.jsx";
import AgendaRailShell from "../agenda/AgendaRailShell.jsx";
import MiniCalendar, { AgendaRailWithMiniCalendar } from "../agenda/MiniCalendar.jsx";
import EventsAgendaDeadlineRow from "./EventsAgendaDeadlineRow.jsx";
import { AllDayChip, TimedRow } from "./EventsAgendaEventRows.jsx";
import { AgendaSkeleton, WeatherHeader } from "./EventsAgendaRailParts.jsx";
import {
  buildEventsAgendaGroups,
  buildEventsMiniCalendarActivityItems,
  buildMultiMonthAgendaGroups,
} from "./eventsAgendaModel.js";
import { useAgendaFetch } from "../../../../hooks/calendar/useAgendaFetch.js";
import { scrollCommandTargetMonth } from "../../../../hooks/calendar/agendaFetchModel.js";

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

function parseMonthKey(mk) {
  const [y, m] = mk.split("-").map(Number);
  return { year: y, month: m - 1 };
}

function dedupeEvents(events) {
  const seen = new Set();
  const result = [];
  for (const event of events) {
    const key = event?.id ? (event.originalStartTime ? `${event.id}::${event.originalStartTime}` : String(event.id)) : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(event);
  }
  return result;
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
  getMonthEvents = null,
  eventsRange = null,
  deadlinesRange = null,
  dataRevision = 0,
}, ref) {
  const todayKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const dragEventRef = useRef(null);
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  const [hoverPreviewItem, setHoverPreviewItem] = useState(null);
  const [topmostMonth, setTopmostMonth] = useState(null);
  const prevEntryTargetRef = useRef(entryScrollTargetDateKey);
  const hasRenderedAgendaRef = useRef(false);

  const multiMonthEnabled = !!getMonthEvents && typeof eventsRange?.ensureRange === "function";

  // A pending scroll command may target a month outside the loaded window
  // (month picker jumps, grid-driven sync, the today hotkey). Surface it so
  // the fetch hook can load that month — the command itself retries once the
  // month mounts.
  const pendingTargetMonth = scrollCommandTargetMonth(scrollCommand, todayKey);

  const { loadedMonths, initialReady } = useAgendaFetch({
    topmostMonth,
    pendingTargetMonth,
    domainRange: eventsRange,
    deadlinesRange,
    todayKey,
    disabled: !multiMonthEnabled,
  });

  const monthDescriptors = useMemo(() => {
    if (!multiMonthEnabled || !loadedMonths.length) return null;
    return loadedMonths.map((mk) => parseMonthKey(mk));
  }, [multiMonthEnabled, loadedMonths]);

  // Rebuilding the agenda groups (flatMap + dedupe + grouping over every
  // loaded month) is the expensive part of a prefetch landing mid-scroll.
  // Deferring the data inputs keeps scroll-driven renders on the previous
  // months and moves the rebuild off the urgent path.
  const deferredMonthDescriptors = useDeferredValue(monthDescriptors);
  const deferredDataRevision = useDeferredValue(dataRevision);

  const allEvents = useMemo(() => {
    if (!multiMonthEnabled || !getMonthEvents || !deferredMonthDescriptors) return events;
    return dedupeEvents(
      deferredMonthDescriptors.flatMap(({ year, month }) => getMonthEvents(year, month) || []),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiMonthEnabled, getMonthEvents, deferredMonthDescriptors, events, deferredDataRevision]);

  const multiMonthGroups = useMemo(() => {
    if (!multiMonthEnabled || !deferredMonthDescriptors) return null;
    return buildMultiMonthAgendaGroups({
      months: deferredMonthDescriptors,
      events: allEvents,
      deadlineOverlay,
      weatherData,
      todayKey,
      forceVisibleDateKey: entryScrollTargetDateKey || selectedDateKey,
    });
  }, [multiMonthEnabled, deferredMonthDescriptors, allEvents, deadlineOverlay, weatherData, todayKey, entryScrollTargetDateKey, selectedDateKey]);

  const singleMonthAgenda = useMemo(() => {
    if (multiMonthEnabled) return null;
    return buildEventsAgendaGroups({
      events,
      deadlineOverlay,
      viewYear,
      viewMonth,
      weatherData,
      todayKey,
      forceVisibleDateKey: entryScrollTargetDateKey || selectedDateKey,
    });
  }, [multiMonthEnabled, deadlineOverlay, entryScrollTargetDateKey, events, selectedDateKey, todayKey, viewMonth, viewYear, weatherData]);

  const months = useMemo(() => {
    if (multiMonthGroups) return multiMonthGroups;
    if (!singleMonthAgenda) return [];
    return [{
      monthKey: `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`,
      year: viewYear,
      month: viewMonth,
      ...singleMonthAgenda,
    }];
  }, [multiMonthGroups, singleMonthAgenda, viewYear, viewMonth]);

  const miniCalendarItems = useMemo(() => buildEventsMiniCalendarActivityItems({
    events,
    deadlineOverlay,
    viewYear,
    viewMonth,
  }), [deadlineOverlay, events, viewMonth, viewYear]);

  if (prevEntryTargetRef.current !== entryScrollTargetDateKey) {
    prevEntryTargetRef.current = entryScrollTargetDateKey;
    hasRenderedAgendaRef.current = false;
  }

  const readinessState = deadlineOverlay?.readiness?.state;
  const waitingForPlanningReadiness = ["idle", "loading", "slow"].includes(readinessState);
  const entryScrollReady = entryScrollReadyProp ?? !waitingForPlanningReadiness;
  const rawShowAgendaSkeleton = !entryScrollReady
    || (multiMonthEnabled && !initialReady)
    || (isLoading && !months.some((m) => m.visibleGroups.some((g) => g.hasEvents)));
  if (!rawShowAgendaSkeleton) hasRenderedAgendaRef.current = true;
  const showAgendaSkeleton = hasRenderedAgendaRef.current ? false : rawShowAgendaSkeleton;

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
      detailKind: "deadline",
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

  const handleTopmostDateChange = useCallback((dateKey) => {
    if (dateKey) {
      setTopmostMonth(dateKey.slice(0, 7));
    }
    onPassiveDateChange?.(dateKey);
  }, [onPassiveDateChange]);

  const renderMonth = useCallback((month, { registerHeader, registerSection, registerRow, registerContent }) => (
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
      renderHeader={({ group: g, registerHeader: regHeader }) => (
        <AgendaHeader
          group={g}
          todayKey={todayKey}
          registerHeader={regHeader}
          onActivate={handleDateAction}
          dropActive={eventQuickActions?.dropTargetDate === g.dateKey}
          quickActions={eventQuickActions}
        />
      )}
      renderGroup={({ group: g, registerRow: regRow, registerContent: regContent }) => {
        const expanded = expandedDays.has(g.dateKey);
        const visibleAllDay = expanded ? g.allDay : g.allDay.slice(0, 2);
        const hiddenAllDayCount = g.allDay.length - visibleAllDay.length;
        const showNoEvents = !g.hasEvents && (g.isFallback || selectedDateKey === g.dateKey || todayKey === g.dateKey);
        return (
          <>
            {g.allDay.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
                {visibleAllDay.map((event) => (
                  <span
                    key={keyForEvent(event, g.dateKey)}
                    ref={(node) => regRow(keyForEvent(event, g.dateKey), node, g.dateKey)}
                    style={{ minWidth: 0, maxWidth: "100%" }}
                    onDragStart={() => {
                      dragEventRef.current = event;
                    }}
                  >
                    <AllDayChip
                      event={event}
                      selected={isSelectedAgendaEvent(event, g.dateKey, selectedItemId, selectedDateKey)}
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
                        next.add(g.dateKey);
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
            {g.timed.map((event) => (
              <span
                key={keyForEvent(event, g.dateKey)}
                ref={(node) => regRow(keyForEvent(event, g.dateKey), node, g.dateKey)}
                onDragStart={() => {
                  dragEventRef.current = event;
                }}
              >
                <TimedRow
                  event={event}
                  dateKey={g.dateKey}
                  todayKey={todayKey}
                  selected={isSelectedAgendaEvent(event, g.dateKey, selectedItemId, selectedDateKey)}
                  onSelect={handleEventSelect}
                  quickActions={eventQuickActions}
                  onDirtyBlocked={dirtyBlocked}
                  onPreviewStart={(item) => startHoverPreview(item, "event")}
                  onPreviewEnd={endHoverPreview}
                />
              </span>
            ))}
            {g.deadlines.map((deadline) => {
              const selected = String(selectedItemId || "") === String(deadline.agendaItemId || "")
                && selectedDateKey === g.dateKey;
              return (
                <EventsAgendaDeadlineRow
                  key={`deadline-${deadline.agendaItemId}-${g.dateKey}`}
                  deadline={deadline}
                  dateKey={g.dateKey}
                  selected={selected}
                  registerRow={regRow}
                  onSelect={handleDeadlineSelect}
                  onPreviewStart={(item) => startHoverPreview(item, "deadline")}
                  onPreviewEnd={endHoverPreview}
                />
              );
            })}
            {showNoEvents ? (
              <div
                ref={(node) => regContent(g.dateKey, node)}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [todayKey, selectedDateKey, selectedItemId, eventQuickActions, expandedDays, floatingEditorDirty]);

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
        <AgendaMonthScrollContainer
          ref={ref}
          testId="events-agenda-rail"
          months={months}
          todayKey={todayKey}
          selectedDateKey={selectedDateKey}
          scrollCommand={scrollCommand}
          entryScrollTargetDateKey={entryScrollTargetDateKey}
          isLoading={isLoading}
          entryScrollReady={entryScrollReady}
          floatingEditorDirty={floatingEditorDirty}
          itemScrollTopOffset={EVENT_SCROLL_TOP_OFFSET}
          onTopmostDateChange={handleTopmostDateChange}
          skeleton={<AgendaSkeleton />}
          showSkeleton={showAgendaSkeleton}
          renderMonth={renderMonth}
        />
      )}
    </AgendaRailWithMiniCalendar>
  );
});

export default EventsAgendaRail;
