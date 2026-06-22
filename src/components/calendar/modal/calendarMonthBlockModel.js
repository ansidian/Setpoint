// Per-mounted-month block-state derivation, extracted from the render loop of
// CalendarScrollContainer. Pure: given a month and the active/cached context, it
// decides whether the block is the active month, the previously-active (cached)
// month, whether it has full data (vs a lightweight preview), and whether it
// should show a skeleton. `isCached` deliberately returns the same falsy operand
// as the original `!isActive && cached && key === ...` (it may be the cached
// object's absence, not a coerced boolean) because resolveMountedMonthData reads
// it only in a boolean context.
export function resolveMonthBlockState({
  year,
  month,
  viewYear,
  viewMonth,
  cached,
  monthCached,
  showGridSkeleton,
}) {
  const isActive = year === viewYear && month === viewMonth;
  const isCached = !isActive && cached && `${year}-${month}` === cached.key;
  const hasFullData = isActive || isCached;
  const blockSkeleton = isActive ? showGridSkeleton : !monthCached;
  return { isActive, isCached, hasFullData, blockSkeleton };
}
