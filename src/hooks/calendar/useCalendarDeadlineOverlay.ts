import { useCallback, useEffect, useMemo } from "react";
import { getVisibleGridRange } from "../../components/calendar/calendarDateUtils.ts";
import usePlanningReadinessState, { type PlanningReadinessStateOptions } from "./usePlanningReadinessState";
import {
  deadlineOverlayRecordData,
  makeDeadlineOverlayRecord,
  rangeMatches,
} from "./calendarControllerHelpers";
import type { CalendarDateRange } from "./calendarControllerHelpers";

export interface CalendarDeadlineOverlayOptions<T = unknown> extends PlanningReadinessStateOptions<T> {
  viewYear: number;
  viewMonth: number;
  completedDeadlineOverlayVisible: boolean;
  deadlinesRangeData?: {
    dataRange?: CalendarDateRange | null;
    data?: T | null;
    revision?: number;
  } | null;
  deadlinesData?: T | null;
}

// Deadline-overlay orchestration extracted from useCalendarModalController.tsx
// (fe-global::calendar-controller-god-component). Owns the planning-readiness
// state machine, the late-deadline apply path, the per-settle committed-overlay
// record, and the identity-stabilized overlay object that downstream memos key
// on. Behavior-preserving: same hooks, same effects, same memo keys and
// short-circuits as the inline version — only relocated.
export default function useCalendarDeadlineOverlay<T = unknown>({
  open,
  view,
  fetchYear,
  fetchMonth,
  viewYear,
  viewMonth,
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
  completedDeadlineOverlayVisible,
  deadlinesEnsureRange,
  deadlinesRangeData,
  deadlinesData,
}: CalendarDeadlineOverlayOptions<T>) {
  const {
    planningReadiness,
    setPlanningReadiness,
    committedDeadlineOverlayData,
    setCommittedDeadlineOverlayData,
    lateDeadlineOverlayData,
    setLateDeadlineOverlayData,
  } = usePlanningReadinessState({
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
  });

  const lateDeadlineRecord = useMemo(() => {
    if (view !== "events") return null;
    const visibleRange = getVisibleGridRange(viewYear, viewMonth);
    return deadlineOverlayRecordData(lateDeadlineOverlayData, visibleRange) ? lateDeadlineOverlayData : null;
  }, [view, viewYear, viewMonth, lateDeadlineOverlayData]);

  const applyLateDeadlines = useCallback(() => {
    if (!lateDeadlineRecord) return;
    setCommittedDeadlineOverlayData(lateDeadlineRecord);
    setLateDeadlineOverlayData(null);
    setPlanningReadiness((current) => ({
      ...current,
      state: "ready",
      deadlinesDelayed: false,
      lateDeadlinesReady: false,
    }));
  }, [lateDeadlineRecord, setCommittedDeadlineOverlayData, setLateDeadlineOverlayData, setPlanningReadiness]);

  const deadlinesDelayed = !!planningReadiness.deadlinesDelayed;
  const deadlineOverlayCandidate = useMemo(() => {
    if (view !== "events") return null;
    const visibleRange = getVisibleGridRange(viewYear, viewMonth);
    const committedOverlayData = deadlineOverlayRecordData(committedDeadlineOverlayData, visibleRange);
    const seededOverlayData = !deadlinesDelayed
      && (!deadlinesRangeData?.dataRange || rangeMatches(deadlinesRangeData.dataRange, visibleRange))
      ? deadlinesRangeData?.data
      : null;
    const currentOverlayData = !deadlinesDelayed ? deadlinesData : null;
    const overlayData = committedOverlayData || seededOverlayData || currentOverlayData;
    return {
      enabled: deadlineOverlayVisible,
      showCompleted: completedDeadlineOverlayVisible,
      data: deadlineOverlayVisible ? overlayData : null,
      onApplyLateDeadlines: lateDeadlineRecord ? applyLateDeadlines : null,
    };
  }, [
    view,
    viewYear,
    viewMonth,
    committedDeadlineOverlayData,
    deadlinesDelayed,
    deadlinesRangeData?.dataRange,
    deadlinesRangeData?.data,
    deadlinesData,
    deadlineOverlayVisible,
    completedDeadlineOverlayVisible,
    lateDeadlineRecord,
    applyLateDeadlines,
  ]);

  // Month crossings recompute the candidate (the committed record is gated on
  // the visible range), usually to field-identical output. Re-key on the four
  // overlay fields so the object identity only changes when content does, and
  // downstream memos keyed on overlay identity stay warm. (Equivalent to the
  // previous prev-value-ref stabilization, but without a render-time ref read.)
  const deadlineOverlay = useMemo(
    () => deadlineOverlayCandidate,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity gated on the candidate's fields, not its reference
    [
      deadlineOverlayCandidate?.enabled,
      deadlineOverlayCandidate?.showCompleted,
      deadlineOverlayCandidate?.data,
      deadlineOverlayCandidate?.onApplyLateDeadlines,
    ],
  );

  useEffect(() => {
    if (view !== "events" || !deadlineOverlayVisible || !deadlinesRangeData?.data) return;
    const visibleRange = getVisibleGridRange(viewYear, viewMonth);
    if (!rangeMatches(deadlinesRangeData?.dataRange, visibleRange)) return;
    // Re-committing an identical record per settle would churn the overlay
    // identity (and everything memoized on it) without changing content.
    setCommittedDeadlineOverlayData((current) => (
      current
        && current.data === deadlinesRangeData.data
        && rangeMatches(current.range, deadlinesRangeData.dataRange)
        ? current
        : makeDeadlineOverlayRecord(deadlinesRangeData.data, deadlinesRangeData.dataRange)
    ));
  }, [
    view,
    viewYear,
    viewMonth,
    deadlineOverlayVisible,
    deadlinesRangeData?.data,
    deadlinesRangeData?.dataRange,
    deadlinesRangeData?.revision,
    setCommittedDeadlineOverlayData,
  ]);

  return {
    planningReadiness,
    committedDeadlineOverlayData,
    lateDeadlineOverlayData,
    deadlineOverlay,
  };
}
