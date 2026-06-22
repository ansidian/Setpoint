import { monthIndexToDate } from "./calendarScrollModel.js";

// The pure settle decision tree, extracted from CalendarScrollContainer's
// scheduleSettle timer. Given the indices/flags the timer reads off its refs at
// fire time, it returns exactly what the timer must DO — without touching a
// clock, the DOM, or any ref. The timer stays a thin translator: read refs →
// resolveScrollSettle → apply outputs.
//
// Inputs:
//   scrollDataIndex   - the data index the scroll handler last observed
//   scrollMountIndex  - the committed mounted index (also the settled index)
//   prevView          - { year, month } | null, the last view the grid settled on
//   labelIndex        - the index the label month last tracked
//   refYear/refMonth  - the mount origin (seeded from today)
//   wasSuppressed     - programmaticNavActiveRef at fire time (a suppressed
//                       settle merely echoes a programmatic navigation)
//
// When scrollDataIndex !== scrollMountIndex the crossing's commit is still in
// flight, so the only output is { shouldDefer: true } (the caller re-arms).
export function resolveScrollSettle({
  scrollDataIndex,
  scrollMountIndex,
  prevView,
  labelIndex,
  refYear,
  refMonth,
  wasSuppressed,
}) {
  if (scrollDataIndex !== scrollMountIndex) {
    return { shouldDefer: true };
  }
  const { year, month } = monthIndexToDate(scrollMountIndex, refYear, refMonth);
  const settledAway = !prevView || prevView.year !== year || prevView.month !== month;
  const labelDate = monthIndexToDate(labelIndex, refYear, refMonth);
  // A settle that crosses to a new month while suppressed re-asserts user-driven
  // semantics so the display-month change propagates; otherwise the flag clears.
  const displayMonthChange = wasSuppressed && settledAway ? { year, month } : null;
  return {
    shouldDefer: false,
    settledMonth: { year, month },
    settledAway,
    scrollDrivenAfter: !!displayMonthChange,
    displayMonthChange,
    labelMonthChange: wasSuppressed
      ? { year: labelDate.year, month: labelDate.month }
      : null,
    // A settle that merely echoes a programmatic navigation is not user intent;
    // consumers must not re-target the agenda rail off it.
    fetchSettleArgs: { year, month, scrollDriven: !wasSuppressed || settledAway },
    // Resting row alignment replaces native CSS snap, but suppressed settles
    // (programmatic landings + the alignment's own echo) must not re-align.
    shouldAlign: !wasSuppressed,
  };
}
