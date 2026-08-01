import { forwardRef, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import type { ForwardedRef } from "react";
import { ymdFromParts } from "../../calendarDateUtils.ts";
import AgendaMonthScrollContainer from "../agenda/AgendaMonthScrollContainer.tsx";
import MiniCalendar, { AgendaRailWithMiniCalendar } from "../agenda/MiniCalendar.tsx";
import EventsAgendaMonthSection from "./EventsAgendaMonthSection.tsx";
import type {
  AgendaSelectAnchorKind,
  EventsAgendaRailQuickActions,
  PreviewKind,
} from "./EventsAgendaMonthSection.tsx";
import { AgendaSkeleton } from "./EventsAgendaRailParts.tsx";
import {
  buildEventsAgendaGroups,
  buildEventsMiniCalendarActivityItems,
  reuseMultiMonthAgendaGroups,
} from "./eventsAgendaModel.ts";
import { useAgendaFetch } from "../../../../hooks/calendar/useAgendaFetch";
import { scrollCommandTargetMonth } from "../../../../hooks/calendar/agendaFetchModel";
import type { AgendaRangeController } from "../../../../hooks/calendar/useAgendaFetch";
import type {
  AgendaMonthScrollHandle,
  AgendaRegistrationCallbacks,
  AgendaScrollCommand,
  AgendaScrollMonth,
} from "../agenda/AgendaMonthScrollContainer";
import type { AgendaEvent, AgendaDeadline, EventsAgendaMonthResult } from "./eventsAgendaModel";
import type { CalendarDeadlineOverlay, CalendarItemLike, CalendarWeatherData } from "../calendarViewTypes";

interface EventActionPayload {
  event: CalendarItemLike;
  item?: CalendarItemLike;
  dateKey?: string | null;
  anchorElement: HTMLElement;
  sourceCellElement: HTMLElement;
  anchorKind: AgendaSelectAnchorKind | "agenda-deadline-row";
  detailKind?: "deadline";
}

const EVENT_SCROLL_TOP_OFFSET = 44;

function previewSourceKey(item: CalendarItemLike | null | undefined): string {
  return `${item?.agendaItemId || item?.id || ""}:${item?.agendaDateKey || item?.dateKey || ""}`;
}

function previewItemForAgenda(item: CalendarItemLike, kind: PreviewKind): CalendarItemLike {
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

function parseMonthKey(mk: string): { year: number; month: number } {
  const [y, m] = mk.split("-").map(Number);
  return { year: y || 0, month: (m || 1) - 1 };
}

export interface EventsAgendaRailProps {
  viewYear: number;
  viewMonth: number;
  events?: CalendarItemLike[];
  deadlineOverlay?: CalendarDeadlineOverlay | null;
  weatherData?: CalendarWeatherData | null;
  isLoading?: boolean;
  entryScrollReady?: boolean | null;
  selectedDateKey?: string | null;
  selectedItemId?: unknown;
  scrollCommand?: AgendaScrollCommand | null;
  entryScrollTargetDateKey?: string | false | null;
  currentYear: number;
  currentMonth: number;
  todayDate: number;
  canGoPrev?: boolean;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
  eventQuickActions?: EventsAgendaRailQuickActions | null;
  floatingEditorDirty?: boolean;
  onDirtyBlocked?: () => void;
  onPassiveDateChange?: (dateKey: string) => void;
  onDateAction?: (dateKey: string) => void;
  onCreateEvent?: () => void;
  onMiniCalendarDateAction?: (dateKey: string) => void;
  onMiniCalendarDateCreate?: (dateKey: string) => void;
  hideMiniCalendar?: boolean;
  mobileAgenda?: boolean;
  onEventAction?: (payload: EventActionPayload) => void;
  getMonthEvents?: ((year: number, month: number) => CalendarItemLike[]) | null;
  eventsRange?: AgendaRangeController | null;
  deadlinesRange?: AgendaRangeController | null;
  dataRevision?: number;
  planningReadinessState?: string | null;
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
  hideMiniCalendar = false,
  mobileAgenda = false,
  onEventAction,
  getMonthEvents = null,
  eventsRange = null,
  deadlinesRange = null,
  dataRevision = 0,
  planningReadinessState = null,
}: EventsAgendaRailProps, ref: ForwardedRef<AgendaMonthScrollHandle>) {
  const todayKey = ymdFromParts(currentYear, currentMonth, todayDate);
  const dragEventRef = useRef<AgendaEvent | null>(null);
  const [expandedDays, setExpandedDays] = useState(() => new Set<string>());
  const [hoverPreviewItem, setHoverPreviewItem] = useState<CalendarItemLike | null>(null);
  const [topmostMonth, setTopmostMonth] = useState<string | null>(null);
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

  // Groups are built per month from that month's cache bucket and reused by
  // identity when the month's inputs are unchanged, so a batch landing
  // mid-scroll rebuilds (and re-renders) only the months it touched instead
  // of every loaded month.
  const monthGroupsCacheRef = useRef<Parameters<typeof reuseMultiMonthAgendaGroups>[0]["previous"]>(null);
  const multiMonthGroups = useMemo(() => {
    if (!multiMonthEnabled || !deferredMonthDescriptors) return null;
    const { list, cache } = reuseMultiMonthAgendaGroups({
      previous: monthGroupsCacheRef.current,
      months: deferredMonthDescriptors,
      getMonthEvents,
      deadlineOverlay,
      weatherData,
      todayKey,
      forceVisibleDateKey: entryScrollTargetDateKey || selectedDateKey,
    });
    monthGroupsCacheRef.current = cache;
    return list;
    // deferredDataRevision invalidates the ref-backed getMonthEvents reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiMonthEnabled, deferredMonthDescriptors, getMonthEvents, deadlineOverlay, weatherData, todayKey, entryScrollTargetDateKey, selectedDateKey, deferredDataRevision]);

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

  const readinessState = planningReadinessState ?? deadlineOverlay?.readiness?.state;
  const waitingForPlanningReadiness = ["idle", "loading", "slow"].includes(readinessState || "");
  const entryScrollReady = entryScrollReadyProp ?? !waitingForPlanningReadiness;
  const rawShowAgendaSkeleton = !entryScrollReady
    || (multiMonthEnabled && !initialReady)
    || (isLoading && !months.some((m) => m.visibleGroups.some((g) => g.hasEvents)));
  if (!rawShowAgendaSkeleton) hasRenderedAgendaRef.current = true;
  const showAgendaSkeleton = hasRenderedAgendaRef.current ? false : rawShowAgendaSkeleton;

  const dirtyBlocked = useCallback(() => {
    if (!floatingEditorDirty) return false;
    onDirtyBlocked?.();
    return true;
  }, [floatingEditorDirty, onDirtyBlocked]);

  const handleDateAction = useCallback((dateKey: string) => {
    if (dirtyBlocked()) return;
    onDateAction?.(dateKey);
  }, [dirtyBlocked, onDateAction]);

  const handleEventSelect = useCallback((event: AgendaEvent, element: HTMLElement, anchorKind: AgendaSelectAnchorKind) => {
    if (dirtyBlocked()) return;
    onEventAction?.({
      event,
      dateKey: event.agendaDateKey,
      anchorElement: element,
      sourceCellElement: element,
      anchorKind,
    });
  }, [dirtyBlocked, onEventAction]);

  const handleDeadlineSelect = useCallback((deadline: AgendaDeadline, element: HTMLElement) => {
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
  }, [dirtyBlocked, onEventAction]);

  const startHoverPreview = useCallback((item: CalendarItemLike, kind: PreviewKind) => {
    setHoverPreviewItem(previewItemForAgenda(item, kind));
  }, []);

  const endHoverPreview = useCallback((item: CalendarItemLike) => {
    const sourceKey = previewSourceKey(item);
    setHoverPreviewItem((current) => (
      current?.previewSourceKey === sourceKey ? null : current
    ));
  }, []);

  const expandDay = useCallback((dateKey: string) => {
    setExpandedDays((current) => {
      const next = new Set(current);
      next.add(dateKey);
      return next;
    });
  }, []);

  const handleTopmostDateChange = useCallback((dateKey: string) => {
    if (dateKey) {
      setTopmostMonth(dateKey.slice(0, 7));
    }
    onPassiveDateChange?.(dateKey);
  }, [onPassiveDateChange]);

  const renderMonth = useCallback((month: AgendaScrollMonth, { registerHeader, registerSection, registerRow, registerContent }: AgendaRegistrationCallbacks) => (
    <EventsAgendaMonthSection
      month={month as EventsAgendaMonthResult}
      registerHeader={registerHeader}
      registerSection={registerSection}
      registerRow={registerRow}
      registerContent={registerContent}
      todayKey={todayKey}
      selectedDateKey={selectedDateKey}
      selectedItemId={selectedItemId}
      eventQuickActions={eventQuickActions}
      expandedDays={expandedDays}
      onExpandDay={expandDay}
      onDateAction={handleDateAction}
      onEventSelect={handleEventSelect}
      onDeadlineSelect={handleDeadlineSelect}
      onDirtyBlocked={dirtyBlocked}
      onPreviewStart={startHoverPreview}
      onPreviewEnd={endHoverPreview}
      dragEventRef={dragEventRef}
      mobileAgenda={mobileAgenda}
    />
  ), [todayKey, selectedDateKey, selectedItemId, eventQuickActions, expandedDays, expandDay, handleDateAction, handleEventSelect, handleDeadlineSelect, dirtyBlocked, startHoverPreview, endHoverPreview, mobileAgenda]);

  return (
    <AgendaRailWithMiniCalendar
      miniCalendar={hideMiniCalendar ? null : (
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
