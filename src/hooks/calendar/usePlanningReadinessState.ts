import { useEffect, useState, type MutableRefObject } from "react";
import { getVisibleGridRange } from "../../components/calendar/calendarDateUtils.ts";
import {
  dateToMonthIndex,
  prefetchRange as computePrefetchRange,
  monthIndexToDate,
} from "./calendarScrollModel";
import { monthKey } from "./calendarRangeModel";
import {
  planningDeadlinesReadyState,
  planningDeadlineTimedOutState,
  planningEventsReadyState,
  planningIdleState,
  planningInitialState,
  planningLateDeadlinesReadyState,
  planningSettledState,
  planningSlowState,
} from "./calendarPlanningSessionModel";
import type { CalendarScrollDirection } from "./calendarScrollModel";

export const PLANNING_SLOW_TIMEOUT_MS = 2000;
export const PLANNING_DEGRADED_TIMEOUT_MS = 3000;
export const PLANNING_EDITOR_OPEN_DELAY_MS = 260;

export interface CalendarDateRange { start: string; end: string }
export interface DeadlineOverlayRecord<T = unknown> { data: T; range: CalendarDateRange }
export interface PlanningReadinessStateOptions<T = unknown> {
  open: boolean;
  view: string;
  fetchYear: number;
  fetchMonth: number;
  currentYear: number;
  currentMonth: number;
  scrollDrivenRef: MutableRefObject<boolean>;
  scrollDirectionRef: MutableRefObject<CalendarScrollDirection>;
  fetchAbortRef: MutableRefObject<AbortController | null>;
  eventsEnsureRange?: (start: string, end: string, options: { signal: AbortSignal; prefetchKeys: string[] }) => Promise<unknown>;
  eventsRevision: number;
  eventEditorIsEditorOpen: boolean;
  onEventsVisibleRangeChange?: (range: CalendarDateRange) => void;
  deadlineOverlayVisible: boolean;
  deadlinesEnsureRange?: (start: string, end: string) => Promise<T>;
}

function makeDeadlineOverlayRecord<T>(data: T | null | undefined, range: CalendarDateRange | null): DeadlineOverlayRecord<T> | null {
  return data && range ? { data, range } : null;
}

/**
 * Owns the calendar planning-readiness state machine (idle → loading → slow →
 * degraded → ready / error) and the deadline-overlay data cache it gates
 * (committed + late). On each visible-range change it fetches events + deadlines,
 * escalates to "slow" after PLANNING_SLOW_TIMEOUT_MS and "degraded" after
 * PLANNING_DEGRADED_TIMEOUT_MS, and commits or stashes (as "late") the deadline
 * payload depending on whether the deadline fetch beat the degrade timeout. When
 * the event editor is open the ensure pass is deferred by
 * PLANNING_EDITOR_OPEN_DELAY_MS so it doesn't disrupt an active edit.
 *
 * The pure transitions live in calendarPlanningSessionModel; this hook only
 * orchestrates timers, async settlement, and React state.
 *
 * Scroll-driven fetches (infinite month scroll) are special-cased: the ensure pass
 * anchors on the fetch anchor (fetchYear/fetchMonth, decoupled from the display
 * month), prefetches ahead of the scroll direction, aborts any in-flight pass via
 * fetchAbortRef, and skips the planning-state reset so cached months render without
 * a skeleton flash.
 */
export default function usePlanningReadinessState<T = unknown>({
  open,
  view,
  fetchYear,
  fetchMonth,
  currentYear,
  currentMonth,
  scrollDrivenRef,
  scrollDirectionRef,
  fetchAbortRef,
  eventsEnsureRange,
  eventsRevision,
  eventEditorIsEditorOpen,
  onEventsVisibleRangeChange,
  deadlineOverlayVisible,
  deadlinesEnsureRange,
}: PlanningReadinessStateOptions<T>) {
  const [planningReadiness, setPlanningReadiness] = useState(planningIdleState);
  const [committedDeadlineOverlayData, setCommittedDeadlineOverlayData] = useState<DeadlineOverlayRecord<T> | null>(null);
  const [lateDeadlineOverlayData, setLateDeadlineOverlayData] = useState<DeadlineOverlayRecord<T> | null>(null);

  useEffect(() => {
    if (!open || view !== "events" || !eventsEnsureRange) {
      // Consume a flag set by a settle that landed as the modal closed (the
      // modal stays mounted) or off the events view; the next pass must not
      // skip its planning reset against stale scroll state.
      scrollDrivenRef.current = false;
      return;
    }
    const { start, end } = getVisibleGridRange(fetchYear, fetchMonth);
    onEventsVisibleRangeChange?.({ start, end });

    const isScrollDriven = scrollDrivenRef.current;
    scrollDrivenRef.current = false;

    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
      fetchAbortRef.current = null;
    }
    const abortController = new AbortController();
    fetchAbortRef.current = abortController;
    const { signal } = abortController;

    const scrollDir = scrollDirectionRef.current;
    const visibleIndex = dateToMonthIndex(fetchYear, fetchMonth, currentYear, currentMonth);
    const { first: pfFirst, last: pfLast } = computePrefetchRange({
      visibleFirst: visibleIndex,
      visibleLast: visibleIndex,
      scrollDirection: scrollDir,
    });
    const prefetchKeys: string[] = [];
    for (let i = pfFirst; i <= pfLast; i++) {
      const { year, month } = monthIndexToDate(i, currentYear, currentMonth);
      prefetchKeys.push(monthKey(year, month));
    }

    const runEnsure = () => {
      if (signal.aborted) return;
      let canceled = false;
      let eventsDone = false;
      let deadlinesDone = !deadlineOverlayVisible || !deadlinesEnsureRange;
      let deadlinesTimedOut = false;
      const startedAt = performance.now();
      if (!isScrollDriven) {
        setPlanningReadiness(planningInitialState({
          deadlineOverlayVisible,
          deadlinesDone,
          startedAt,
        }));
        setLateDeadlineOverlayData(null);
      }

      const onAbort = () => { canceled = true; };
      signal.addEventListener("abort", onAbort);

      const softTimer = window.setTimeout(() => {
        // P3-5: no-op once the pass has already settled, so a fast successful
        // load is never flipped back to "slow" by this leaked timer.
        if (canceled || !deadlineOverlayVisible || (eventsDone && deadlinesDone)) return;
        setPlanningReadiness((current) => planningSlowState(current, {
          eventsDone,
          deadlinesDone,
        }));
      }, PLANNING_SLOW_TIMEOUT_MS);
      const hardTimer = window.setTimeout(() => {
        if (canceled || !deadlineOverlayVisible || deadlinesDone || !eventsDone) return;
        deadlinesTimedOut = true;
        setCommittedDeadlineOverlayData(null);
        setPlanningReadiness((current) => planningDeadlineTimedOutState(current));
      }, PLANNING_DEGRADED_TIMEOUT_MS);

      const eventsPromise = eventsEnsureRange(start, end, { signal, prefetchKeys })
        .then(() => {
          eventsDone = true;
          if (canceled) return;
          setPlanningReadiness((current) => planningEventsReadyState(current, {
            now: performance.now(),
          }));
        });
      const deadlinesPromise = deadlineOverlayVisible && deadlinesEnsureRange
        ? deadlinesEnsureRange(start, end)
          .then((data) => {
            deadlinesDone = true;
            if (canceled) return;
            if (deadlinesTimedOut) {
              setLateDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setPlanningReadiness((current) => planningDeadlinesReadyState(current, {
                now: performance.now(),
                eventsDone,
                deadlinesTimedOut: true,
              }));
              return;
            }
            if (eventsDone) {
              setCommittedDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setLateDeadlineOverlayData(null);
              setPlanningReadiness((current) => planningDeadlinesReadyState(current, {
                now: performance.now(),
                eventsDone,
              }));
            } else {
              setCommittedDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
              setPlanningReadiness((current) => planningDeadlinesReadyState(current, {
                now: performance.now(),
                eventsDone,
              }));
            }
          })
        : Promise.resolve(null);

      Promise.allSettled([eventsPromise, deadlinesPromise]).then((results) => {
        // P3-5: the pass has settled — clear the escalation timers so a fast
        // load can't be flipped to "slow"/"degraded" ~2-3s later. Teardown
        // cleanup still clears them on effect re-run/unmount.
        window.clearTimeout(softTimer);
        window.clearTimeout(hardTimer);
        if (canceled) return;
        const failed = results.find((result) => result.status === "rejected");
        if (failed) {
          setPlanningReadiness((current) => planningSettledState(current, {
            failed: true,
          }));
          return;
        }
        if (!deadlineOverlayVisible) return;
        if (deadlinesDone && eventsDone) {
          setPlanningReadiness((current) => planningSettledState(current, {
            failed: false,
            deadlineOverlayVisible,
            deadlinesDone,
            eventsDone,
          }));
        }
      });

      deadlinesPromise.then((data) => {
        if (canceled || !deadlineOverlayVisible || !data) return;
        setPlanningReadiness((current) => {
          if (!current.deadlinesDelayed) return current;
          setLateDeadlineOverlayData(makeDeadlineOverlayRecord(data, { start, end }));
          return planningLateDeadlinesReadyState(current);
        });
      }).catch(() => {});

      return () => {
        canceled = true;
        signal.removeEventListener("abort", onAbort);
        window.clearTimeout(softTimer);
        window.clearTimeout(hardTimer);
      };
    };

    if (eventEditorIsEditorOpen) {
      let cleanup: (() => void) | undefined;
      const id = window.setTimeout(() => {
        cleanup = runEnsure();
      }, PLANNING_EDITOR_OPEN_DELAY_MS);
      return () => {
        window.clearTimeout(id);
        abortController.abort();
        cleanup?.();
      };
    }
    const cleanup = runEnsure();
    return () => {
      abortController.abort();
      cleanup?.();
    };
  }, [open, view, fetchYear, fetchMonth, currentYear, currentMonth, scrollDrivenRef, scrollDirectionRef, fetchAbortRef, eventsEnsureRange, eventsRevision, eventEditorIsEditorOpen, onEventsVisibleRangeChange, deadlineOverlayVisible, deadlinesEnsureRange]);

  return {
    planningReadiness,
    setPlanningReadiness,
    committedDeadlineOverlayData,
    setCommittedDeadlineOverlayData,
    lateDeadlineOverlayData,
    setLateDeadlineOverlayData,
  };
}
