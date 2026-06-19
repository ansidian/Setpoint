import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalendarGrid from "./CalendarGrid.jsx";
import { getMonthData } from "../calendarDateUtils.js";
import { buildMonthPreviewEntries, resolveMountedMonthData } from "./calendarMonthPreviewModel.js";
import {
  monthBlockHeight,
  monthIndexToDate,
  dateToMonthIndex,
  midpointActiveMonthIndex,
  mountedWindow,
  nearestWeekRowOffset,
  shouldDispatchOverflowCloseOnScroll,
  LABEL_MONTH_THRESHOLD,
  NAVIGABLE_MONTH_RADIUS,
  SCROLL_SETTLE_MS,
} from "../../../hooks/calendar/calendarScrollModel.js";

const SCROLL_RANGE = NAVIGABLE_MONTH_RADIUS;

export default function CalendarScrollContainer({
  view,
  activeView,
  layout,
  currentYear,
  currentMonth,
  todayDate,
  viewYear,
  viewMonth,
  onDisplayMonthChange,
  onLabelMonthChange,
  onFetchSettle,
  viewData,
  itemsByDay = emptyObj,
  itemsByDate = emptyObj,
  cellMetaByDate = emptyObj,
  selectedDay,
  selectedDateKey,
  selectedItemId,
  showGridSkeleton,
  buildFallbackDayState,
  closeEventEditor,
  setSelectedDay,
  setSelectedDateKey,
  setSelectedItemId,
  eventQuickActions,
  deadlineQuickActions,
  ghostPreview,
  onOpenFloatingDetail,
  onCloseFloatingDetail,
  floatingDetailOpen,
  floatingDetailItemId,
  floatingDetailMode,
  floatingDetailDateKey,
  floatingEditorDirty,
  onCancelFloatingEditor,
  onShakeFloatingEditor,
  onDirectDateAction,
  onDirectItemAction,
  isMonthCached,
  getMonthEvents,
  getMonthDeadlines,
  dataRevision = 0,
}) {
  const containerRef = useRef(null);
  const scrollDrivenRef = useRef(false);
  const initializedRef = useRef(false);
  const skipFirstNavRef = useRef(true);
  const crossfadeVersionRef = useRef(0);
  const prevViewRef = useRef(null);
  const [refYear] = useState(currentYear);
  const [refMonth] = useState(currentMonth);

  const activeIndex = dateToMonthIndex(viewYear, viewMonth, refYear, refMonth);

  const [scrollMountIndex, setScrollMountIndex] = useState(activeIndex);
  const [prevActiveIndex, setPrevActiveIndex] = useState(activeIndex);
  if (prevActiveIndex !== activeIndex) {
    setPrevActiveIndex(activeIndex);
    setScrollMountIndex(activeIndex);
  }
  const scrollMountIndexRef = useRef(scrollMountIndex);
  const onDisplayMonthChangeRef = useRef(onDisplayMonthChange);
  const onLabelMonthChangeRef = useRef(onLabelMonthChange);
  const onFetchSettleRef = useRef(onFetchSettle);
  const editorScrollRef = useRef({
    open: false,
    dirty: false,
    cancel: null,
  });
  const cleanEditorCanceledRef = useRef(false);
  const labelIndexRef = useRef(activeIndex);
  const scrollSettleTimerRef = useRef(null);
  const programmaticNavActiveRef = useRef(false);
  // The data index the scroll handler last observed. scrollMountIndexRef only
  // catches up at commit; comparing the two tells the settle whether a
  // crossing's commit is still in flight.
  const scrollDataIdxRef = useRef(activeIndex);
  const alignToWeekRowRef = useRef(null);

  useEffect(() => {
    scrollMountIndexRef.current = scrollMountIndex;
    onDisplayMonthChangeRef.current = onDisplayMonthChange;
    onLabelMonthChangeRef.current = onLabelMonthChange;
    onFetchSettleRef.current = onFetchSettle;
    editorScrollRef.current = {
      open: floatingDetailMode === "edit" || floatingDetailMode === "create",
      dirty: !!floatingEditorDirty,
      cancel: onCancelFloatingEditor,
    };
  });

  useEffect(() => {
    cleanEditorCanceledRef.current = false;
  }, [floatingDetailMode, floatingEditorDirty, floatingDetailOpen]);

  const getHeight = useCallback(
    (index) => {
      const { year, month } = monthIndexToDate(index, refYear, refMonth);
      return monthBlockHeight({
        year,
        month,
        cellHeight: layout.cellHeight,
        gridGap: layout.gridGap,
      });
    },
    [refYear, refMonth, layout.cellHeight, layout.gridGap],
  );

  const offsets = useMemo(() => {
    const map = new Map();
    let pos = 0;
    for (let i = -SCROLL_RANGE; i <= SCROLL_RANGE; i++) {
      map.set(i, pos);
      pos += getHeight(i);
    }
    return map;
  }, [getHeight]);

  const { first: wFirst, last: wLast } = mountedWindow(scrollMountIndex);

  const scheduleSettle = useCallback(() => {
    if (scrollSettleTimerRef.current != null) {
      clearTimeout(scrollSettleTimerRef.current);
    }
    scrollSettleTimerRef.current = setTimeout(() => {
      scrollSettleTimerRef.current = null;
      // A crossing's display-month change commits in a separate scheduler
      // task, and expired timers run ahead of it when the event loop is
      // starved — so this timer can beat the commit it must settle after.
      // Every decision below consumes flags the commit's effects produce;
      // firing early read a stale mounted index (announcing the origin month)
      // and left no pending timer for the re-arm effect, killing the real
      // settle. Defer instead — bounded, because setScrollMountIndex always
      // commits, after which the re-arm effect schedules the genuine settle.
      if (scrollDataIdxRef.current !== scrollMountIndexRef.current) {
        scheduleSettle();
        return;
      }
      const wasSuppressed = programmaticNavActiveRef.current;
      programmaticNavActiveRef.current = false;
      // A crossing whose display-month change the controller ignored leaves
      // the scroll-driven flag unconsumed; clear it so it cannot swallow the
      // next programmatic navigation. The settledAway branch below re-sets
      // it when the settle itself issues a display-month change.
      scrollDrivenRef.current = false;
      const settled = scrollMountIndexRef.current;
      const { year, month } = monthIndexToDate(settled, refYear, refMonth);
      const prev = prevViewRef.current;
      const settledAway = !prev || prev.year !== year || prev.month !== month;
      if (wasSuppressed) {
        if (settledAway) {
          scrollDrivenRef.current = true;
          onDisplayMonthChangeRef.current?.({ year, month });
        }
        const labelDate = monthIndexToDate(labelIndexRef.current, refYear, refMonth);
        onLabelMonthChangeRef.current?.({ year: labelDate.year, month: labelDate.month });
      }
      // A settle that merely echoes a programmatic navigation is not user
      // intent; consumers must not re-target the agenda rail off it.
      onFetchSettleRef.current?.({ year, month, scrollDriven: !wasSuppressed || settledAway });
      // Resting alignment replaces native CSS snap, which fought Windows
      // notch scrolling (Chromium drops wheel events mid-snap-animation).
      // Suppressed settles skip it: programmatic navigations land where they
      // intend, and the alignment's own echo settle must not re-align.
      if (!wasSuppressed) alignToWeekRowRef.current?.();
    }, SCROLL_SETTLE_MS);
  }, [refYear, refMonth]);

  useEffect(() => {
    alignToWeekRowRef.current = () => {
      const container = containerRef.current;
      if (!container) return;
      const target = nearestWeekRowOffset({
        scrollOffset: container.scrollTop,
        cellHeight: layout.cellHeight,
        gridGap: layout.gridGap,
        getMonthOffset: (i) => offsets.get(i) ?? 0,
        getMonthHeight: getHeight,
        searchFirst: -SCROLL_RANGE,
        searchLast: SCROLL_RANGE,
      });
      const maxScroll = container.scrollHeight - container.clientHeight;
      const clamped = maxScroll > 0 ? Math.min(target, maxScroll) : target;
      if (Math.abs(clamped - container.scrollTop) <= 1) return;
      // The write echoes scroll events in real browsers; mark it programmatic
      // so it cannot read as user intent, and re-arm the settle that clears
      // the mark (jsdom fires no echo at all).
      programmaticNavActiveRef.current = true;
      if (container.scrollTo) {
        const reduceMotion =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        container.scrollTo({ top: clamped, behavior: reduceMotion ? "instant" : "smooth" });
      } else {
        container.scrollTop = clamped;
      }
      scheduleSettle();
    };
  }, [offsets, getHeight, layout.cellHeight, layout.gridGap, scheduleSettle]);

  useEffect(() => {
    if (scrollSettleTimerRef.current == null) return;
    // The display-month change that follows a user crossing re-renders with a
    // new activeIndex; clearing the pending settle here killed the settle of
    // the very gesture that caused the crossing. Re-arm it instead so the
    // fetch anchor and trailing agenda sync still fire.
    scheduleSettle();
  }, [activeIndex, scheduleSettle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || initializedRef.current) return;
    initializedRef.current = true;
    // Center the mounted view month: refYear/refMonth are seeded from today,
    // so centering "today's index" is always index 0 and would discard a
    // focus month the modal opened on. The write echoes a scroll event in
    // real browsers — mark it programmatic and arm the settle that clears
    // the mark, so the echo cannot reset the view back to today.
    const targetOffset = offsets.get(activeIndex) ?? 0;
    const targetHeight = getHeight(activeIndex);
    programmaticNavActiveRef.current = true;
    container.scrollTop = targetOffset - (container.clientHeight - targetHeight) / 2;
    scheduleSettle();
  }, [offsets, getHeight, activeIndex, scheduleSettle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function onScrollDismissOverflow() {
      // P3-11: skip the close when a keep-overflow-open chip interaction just
      // fired (its programmatic alignment scroll lands within the shared ignore
      // window) so the overflow the user acted in is not dismissed. The
      // escape/hotkey close dispatches from useCalendarModalHotkeys.js, never
      // through here, so escape stays immediate.
      if (!shouldDispatchOverflowCloseOnScroll()) return;
      document.dispatchEvent(new CustomEvent("calendar-overflow-close"));
    }
    container.addEventListener("scroll", onScrollDismissOverflow, { passive: true });
    return () => container.removeEventListener("scroll", onScrollDismissOverflow);
  }, []);

  useEffect(() => {
    function onReset() {
      const container = containerRef.current;
      if (!container) return;
      programmaticNavActiveRef.current = true;
      const targetIdx = dateToMonthIndex(viewYear, viewMonth, refYear, refMonth);
      const targetOffset = offsets.get(targetIdx);
      if (targetOffset == null) return;
      // The label and data indices normally track scroll events; a
      // programmatic snap lands on the target without any (jsdom fires none
      // at all), and a late settle would otherwise replay a stale label
      // month or defer against a stale data index.
      labelIndexRef.current = targetIdx;
      scrollDataIdxRef.current = targetIdx;
      if (container.scrollTo) {
        container.scrollTo({ top: targetOffset, behavior: "instant" });
      } else {
        container.scrollTop = targetOffset;
      }
    }
    document.addEventListener("calendar-grid-scroll-reset", onReset);
    return () => document.removeEventListener("calendar-grid-scroll-reset", onReset);
  }, [offsets, viewYear, viewMonth, refYear, refMonth]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId = null;
    function onScroll() {
      const editor = editorScrollRef.current;
      // Clean editors cancel on owner scroll only: programmatic navigations
      // (chevron, jump, mount centering) stream scroll events of their own
      // and deliberately preserve open workspaces.
      if (
        !programmaticNavActiveRef.current &&
        editor.open &&
        !editor.dirty &&
        !cleanEditorCanceledRef.current
      ) {
        cleanEditorCanceledRef.current = true;
        editor.cancel?.();
      }
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const scrollTop = container.scrollTop;
        const scrollArgs = {
          scrollOffset: scrollTop,
          containerHeight: container.clientHeight,
          getMonthOffset: (i) => offsets.get(i) ?? 0,
          searchFirst: -SCROLL_RANGE,
          searchLast: SCROLL_RANGE,
        };
        const dataIdx = midpointActiveMonthIndex(scrollArgs);
        const labelIdx = midpointActiveMonthIndex({ ...scrollArgs, threshold: LABEL_MONTH_THRESHOLD });

        // Sync unconditionally (not just on crossings) so a prop-driven
        // navigation that moved the mounted index without scroll events
        // cannot leave a stale mismatch deferring future settles.
        scrollDataIdxRef.current = dataIdx;
        if (dataIdx !== scrollMountIndexRef.current) {
          setScrollMountIndex(dataIdx);
          if (!programmaticNavActiveRef.current) {
            scrollDrivenRef.current = true;
            const { year, month } = monthIndexToDate(dataIdx, refYear, refMonth);
            onDisplayMonthChangeRef.current?.({ year, month });
          }
        }

        if (labelIdx !== labelIndexRef.current) {
          labelIndexRef.current = labelIdx;
          if (!programmaticNavActiveRef.current) {
            const { year, month } = monthIndexToDate(labelIdx, refYear, refMonth);
            onLabelMonthChangeRef.current?.({ year, month });
          }
        }

        scheduleSettle();
      });
    }

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
      if (scrollSettleTimerRef.current != null) {
        clearTimeout(scrollSettleTimerRef.current);
      }
    };
  }, [offsets, refYear, refMonth, scheduleSettle]);

  useEffect(() => {
    if (skipFirstNavRef.current) {
      skipFirstNavRef.current = false;
      prevViewRef.current = { year: viewYear, month: viewMonth };
      return;
    }
    if (scrollDrivenRef.current) {
      scrollDrivenRef.current = false;
      prevViewRef.current = { year: viewYear, month: viewMonth };
      return;
    }
    const container = containerRef.current;
    if (!container || !initializedRef.current) return;
    programmaticNavActiveRef.current = true;
    const targetIdx = dateToMonthIndex(viewYear, viewMonth, refYear, refMonth);
    const targetOffset = offsets.get(targetIdx);
    if (targetOffset == null) return;
    // The label and data indices normally track scroll events; programmatic
    // scrolls settle on the target (jsdom fires no events at all), and a
    // starved settle timer firing after the suppression window would
    // otherwise replay a stale label month or defer against a stale data
    // index.
    labelIndexRef.current = targetIdx;
    scrollDataIdxRef.current = targetIdx;

    const prev = prevViewRef.current;
    const prevIdx = prev
      ? dateToMonthIndex(prev.year, prev.month, refYear, refMonth)
      : targetIdx;
    const distance = Math.abs(targetIdx - prevIdx);
    prevViewRef.current = { year: viewYear, month: viewMonth };

    if (distance > 2) {
      const version = ++crossfadeVersionRef.current;
      container.style.transition = "none";
      container.style.opacity = "0";
      if (container.scrollTo) {
        container.scrollTo({ top: targetOffset, behavior: "instant" });
      } else {
        container.scrollTop = targetOffset;
      }
      requestAnimationFrame(() => {
        if (crossfadeVersionRef.current !== version) return;
        requestAnimationFrame(() => {
          if (crossfadeVersionRef.current !== version) return;
          container.style.transition = "opacity 120ms ease-in";
          container.style.opacity = "1";
          setTimeout(() => { container.style.transition = ""; }, 140);
        });
      });
    } else if (distance > 0) {
      if (container.scrollTo) {
        container.scrollTo({ top: targetOffset, behavior: "smooth" });
      } else {
        container.scrollTop = targetOffset;
      }
    }

    return () => {
      crossfadeVersionRef.current++; // eslint-disable-line react-hooks/exhaustive-deps
      container.style.transition = "";
      container.style.opacity = "1";
    };
  }, [viewYear, viewMonth, offsets, refYear, refMonth]);

  const previewDeadlineOverlay = viewData?.deadlineOverlay ?? null;

  // Preview data for mounted non-active months, keyed by month index.
  // CalendarGrid is memoized, so entry *field* identity is load-bearing:
  // buildMonthPreviewEntries reuses a month's entry whenever its underlying
  // inputs are unchanged, keeping window shifts and unrelated data revisions
  // from re-rendering every mounted grid mid-scroll.
  const previewCacheRef = useRef(null);
  const previewByIndex = useMemo(() => {
    const map = buildMonthPreviewEntries({
      previous: previewCacheRef.current,
      first: wFirst,
      last: wLast,
      refYear,
      refMonth,
      getMonthEvents,
      getMonthDeadlines,
      activeDeadlineOverlay: previewDeadlineOverlay,
    });
    previewCacheRef.current = map;
    return map;
    // dataRevision invalidates the ref-backed getMonthEvents/getMonthDeadlines caches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wFirst, wLast, refYear, refMonth, getMonthEvents, getMonthDeadlines, previewDeadlineOverlay, dataRevision]);

  const activeKey = `${viewYear}-${viewMonth}`;
  const currentMonthData = useMemo(
    () => ({ key: activeKey, viewData, itemsByDay, itemsByDate, cellMetaByDate }),
    [activeKey, viewData, itemsByDay, itemsByDate, cellMetaByDate],
  );
  const [monthDataState, setMonthDataState] = useState(() => ({
    tracked: currentMonthData,
    cached: null,
  }));
  if (monthDataState.tracked.key !== activeKey) {
    setMonthDataState({ tracked: currentMonthData, cached: monthDataState.tracked });
  } else if (monthDataState.tracked !== currentMonthData) {
    setMonthDataState(prev => ({ ...prev, tracked: currentMonthData }));
  }

  // Faint week-row texture for unmounted spacers. Only ±2 months are mounted, so
  // a fast fling can briefly outrun the window and park the viewport on a spacer
  // until the next rAF+commit mounts the month. Drawing the grid's week-row pitch
  // makes that moment read as an empty calendar loading in, not a blank void.
  // Pure CSS on the existing divs: no extra DOM, and off-screen spacers never
  // paint it, so the normal-scroll cost is unchanged.
  const spacerRowPitch = layout.cellHeight + layout.gridGap;
  const spacerBackground = `repeating-linear-gradient(to bottom, rgba(255,255,255,0.025) 0, rgba(255,255,255,0.025) 1px, transparent 1px, transparent ${spacerRowPitch}px)`;

  const activeMonthData = { viewData, itemsByDay, itemsByDate, cellMetaByDate };
  const shareItemsByDate = !!activeView?.monthAgnosticItemsByDate;

  const blocks = [];
  for (let i = -SCROLL_RANGE; i <= SCROLL_RANGE; i++) {
    const { year, month } = monthIndexToDate(i, refYear, refMonth);
    const height = getHeight(i);
    const isMounted = i >= wFirst && i <= wLast;

    if (!isMounted) {
      blocks.push(
        <div
          key={i}
          data-month-index={i}
          data-testid={`month-spacer-${year}-${month}`}
          style={{ height, background: spacerBackground }}
        />,
      );
      continue;
    }

    const { firstDay, daysInMonth } = getMonthData(year, month);
    const isActive = year === viewYear && month === viewMonth;
    const cached = monthDataState.cached;
    const isCached = !isActive && cached && `${year}-${month}` === cached.key;
    const hasFullData = isActive || isCached;
    const monthCached = isMonthCached ? isMonthCached(year, month) : false;
    const blockSkeleton = isActive ? showGridSkeleton : !monthCached;
    const preview = hasFullData ? null : previewByIndex.get(i);
    const previewEvents = preview?.events ?? null;
    const monthDeadlineOverlay = preview ? preview.deadlineOverlay : null;
    const monthData = resolveMountedMonthData({
      isActive,
      isCached,
      cached,
      active: activeMonthData,
      shareItemsByDate,
      empty: emptyObj,
    });

    blocks.push(
      <div
        key={i}
        data-month-block
        data-month-index={i}
        data-testid={`month-block-${year}-${month}`}
        style={{
          height,
          position: "relative",
          zIndex: undefined,
        }}
      >
        <CalendarGrid
          view={view}
          viewYear={year}
          viewMonth={month}
          currentYear={currentYear}
          currentMonth={currentMonth}
          todayDate={todayDate}
          firstDay={firstDay}
          daysInMonth={daysInMonth}
          layout={layout}
          activeView={activeView}
          showWeekHeader={false}
          isActiveMonth={isActive}
          previewEvents={previewEvents}
          previewDeadlineOverlay={monthDeadlineOverlay}
          viewData={monthData.viewData}
          itemsByDay={monthData.itemsByDay}
          itemsByDate={monthData.itemsByDate}
          cellMetaByDate={monthData.cellMetaByDate}
          selectedDay={selectedDay}
          selectedDateKey={selectedDateKey}
          selectedItemId={selectedItemId}
          showGridSkeleton={blockSkeleton}
          buildFallbackDayState={buildFallbackDayState}
          closeEventEditor={closeEventEditor}
          setSelectedDay={setSelectedDay}
          setSelectedDateKey={setSelectedDateKey}
          setSelectedItemId={setSelectedItemId}
          eventQuickActions={eventQuickActions}
          deadlineQuickActions={deadlineQuickActions}
          ghostPreview={isActive ? ghostPreview : null}
          onOpenFloatingDetail={onOpenFloatingDetail}
          onCloseFloatingDetail={onCloseFloatingDetail}
          floatingDetailOpen={floatingDetailOpen}
          floatingDetailItemId={floatingDetailItemId}
          floatingDetailMode={floatingDetailMode}
          floatingDetailDateKey={floatingDetailDateKey}
          floatingEditorDirty={floatingEditorDirty}
          onCancelFloatingEditor={onCancelFloatingEditor}
          onShakeFloatingEditor={onShakeFloatingEditor}
          onDirectDateAction={onDirectDateAction}
          onDirectItemAction={onDirectItemAction}
        />
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="calendar-scroll-container"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        position: "relative",
      }}
    >
      {blocks}
    </div>
  );
}

const emptyObj = {};
