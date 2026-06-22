// Pure entry-readiness projection extracted from useCalendarModalController's
// `viewData` memo (events branch). It decides two things the agenda/grid entry
// animation gates on:
//   - eventsRangeLoading: is any of the three mounted months still fetching?
//   - agendaEntryReady: are events AND deadlines resolved enough to reveal the
//     agenda without a flash of empty-then-populate?
//
// The committed/seeded/current overlay-data resolution and the awaiting/ready
// gates were previously inline in the controller (untested). They live here as
// one pure transform so the truth table is unit-testable without a React tree.
// Inputs mirror the exact fields the controller's memo dep array already lists
// (primitives, not whole objects) so memoization granularity is unchanged.
import { getVisibleGridRange } from "../../components/calendar/calendarDateUtils.js";
import {
  addMonthOffset,
  deadlineOverlayRecordData,
  hasDeadlineItemsInRange,
  rangeMatches,
} from "./calendarControllerHelpers.js";

export function computeCalendarEntryReadiness({
  viewYear,
  viewMonth,
  eventsLoading,
  eventsIsMonthLoading,
  eventsEnsureRange,
  deadlineOverlayVisible,
  committedDeadlineOverlayData,
  deadlinesEnsureRange,
  deadlinesSeedData,
  deadlinesDataRange,
  planningReadiness,
  deadlinesData,
}) {
  const prevMonth = addMonthOffset(viewYear, viewMonth, -1);
  const nextMonth = addMonthOffset(viewYear, viewMonth, 1);
  const visibleRange = getVisibleGridRange(viewYear, viewMonth);
  const committedOverlayData = deadlineOverlayRecordData(committedDeadlineOverlayData, visibleRange);
  const seededOverlayData = !planningReadiness.deadlinesDelayed
    && (!deadlinesDataRange || rangeMatches(deadlinesDataRange, visibleRange))
    ? deadlinesSeedData
    : null;
  const currentOverlayData = !planningReadiness.deadlinesDelayed ? deadlinesData : null;
  const hasResolvedDeadlineRange = !!committedOverlayData
    || !!(seededOverlayData && deadlinesDataRange && rangeMatches(deadlinesDataRange, visibleRange));
  const hasVisibleDeadlineSeed = hasDeadlineItemsInRange(seededOverlayData, visibleRange)
    || hasDeadlineItemsInRange(currentOverlayData, visibleRange);
  const eventsRangeLoading = eventsLoading
    || !!eventsIsMonthLoading?.(prevMonth.year, prevMonth.month)
    || !!eventsIsMonthLoading?.(viewYear, viewMonth)
    || !!eventsIsMonthLoading?.(nextMonth.year, nextMonth.month);
  const awaitingDeadlineOverlay = deadlineOverlayVisible
    && !!deadlinesEnsureRange
    && ["idle", "loading", "slow"].includes(planningReadiness.state)
    && !hasResolvedDeadlineRange
    && !hasVisibleDeadlineSeed;
  const eventsEntryReady = !eventsEnsureRange || !!planningReadiness.eventsReadyAt;
  const deadlinesEntryReady = !deadlineOverlayVisible
    || !deadlinesEnsureRange
    || !!planningReadiness.deadlinesReadyAt
    || !!planningReadiness.deadlinesDelayed;
  const agendaEntryReady = eventsEntryReady && deadlinesEntryReady && !awaitingDeadlineOverlay;
  return { eventsRangeLoading, agendaEntryReady };
}
