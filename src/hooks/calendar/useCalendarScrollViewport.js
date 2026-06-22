import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "./calendarScrollModel.js";
import { resolveScrollSettle } from "./calendarSettleModel.js";

const SCROLL_RANGE = NAVIGABLE_MONTH_RADIUS;

// The infinite-scroll viewport state machine for CalendarScrollContainer: the
// ~12-ref user-vs-programmatic disambiguation, the settle lifecycle (schedule →
// defer-on-mismatch → decide via resolveScrollSettle → align), mount centering,
// the grid-scroll-reset + overflow-close listeners, the rAF scroll handler, and
// the prop-driven navigation/crossfade. Lifted verbatim out of the component so
// the container is a thin map over the mounted window. Returns only what the
// render needs; the editor-cancel cross-cut is injected as maybeCancelEditorOnScroll.
export default function useCalendarScrollViewport({
  viewYear,
  viewMonth,
  currentYear,
  currentMonth,
  layout,
  onDisplayMonthChange,
  onLabelMonthChange,
  onFetchSettle,
  maybeCancelEditorOnScroll,
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
  });

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
      const decision = resolveScrollSettle({
        scrollDataIndex: scrollDataIdxRef.current,
        scrollMountIndex: scrollMountIndexRef.current,
        prevView: prevViewRef.current,
        labelIndex: labelIndexRef.current,
        refYear,
        refMonth,
        wasSuppressed: programmaticNavActiveRef.current,
      });
      // A crossing's display-month change commits in a separate scheduler task,
      // and expired timers run ahead of it when the event loop is starved — so
      // this timer can beat the commit it must settle after. Firing early reads
      // a stale mounted index (announcing the origin month) and leaves no
      // pending timer for the re-arm effect, killing the real settle. Defer
      // instead — bounded, because setScrollMountIndex always commits, after
      // which the re-arm effect schedules the genuine settle.
      if (decision.shouldDefer) {
        // Recursive re-arm: scheduleSettle is stable ([refYear, refMonth]), so
        // the deferred call always runs the latest closure. (Extracting this
        // state machine into a hook un-bailed the React Compiler analyzer, which
        // surfaced this pre-existing pattern — the god component linted clean.)
        // eslint-disable-next-line react-hooks/immutability
        scheduleSettle();
        return;
      }
      // Consume the suppression flag; the model already decided how it gates
      // the rest. A crossing the controller ignored clears scroll-driven so it
      // cannot swallow the next programmatic navigation; a settledAway suppressed
      // settle re-sets it (model: scrollDrivenAfter).
      programmaticNavActiveRef.current = false;
      scrollDrivenRef.current = decision.scrollDrivenAfter;
      if (decision.displayMonthChange) {
        onDisplayMonthChangeRef.current?.(decision.displayMonthChange);
      }
      if (decision.labelMonthChange) {
        onLabelMonthChangeRef.current?.(decision.labelMonthChange);
      }
      onFetchSettleRef.current?.(decision.fetchSettleArgs);
      // Resting alignment replaces native CSS snap, which fought Windows notch
      // scrolling (Chromium drops wheel events mid-snap-animation). Suppressed
      // settles skip it: programmatic navigations land where they intend, and
      // the alignment's own echo settle must not re-align.
      if (decision.shouldAlign) alignToWeekRowRef.current?.();
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
      maybeCancelEditorOnScroll(programmaticNavActiveRef.current);
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
  }, [maybeCancelEditorOnScroll, offsets, refYear, refMonth, scheduleSettle]);

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

  return { containerRef, refYear, refMonth, wFirst, wLast, getHeight };
}
