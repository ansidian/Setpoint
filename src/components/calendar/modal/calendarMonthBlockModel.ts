// Per-mounted-month block-state derivation, extracted from the render loop of
// CalendarScrollContainer. Pure: given a month and the active/cached context, it
// decides whether the block is the active month, the previously-active (cached)
// month, whether it has full data (vs a lightweight preview), and whether it
// should show a skeleton. `isCached` deliberately returns the same falsy operand
// as the original `!isActive && cached && key === ...` (it may be the cached
// object's absence, not a coerced boolean) because resolveMountedMonthData reads
// it only in a boolean context.
export interface CalendarMonthBlockCache { key: string }

export function resolveMonthBlockState({
  year,
  month,
  viewYear,
  viewMonth,
  cached,
  monthCached,
  showGridSkeleton,
}: {
  year: number;
  month: number;
  viewYear: number;
  viewMonth: number;
  cached: CalendarMonthBlockCache | null;
  monthCached: boolean;
  showGridSkeleton: boolean;
}): { isActive: boolean; isCached: boolean | null; hasFullData: boolean | null; blockSkeleton: boolean } {
  const isActive = year === viewYear && month === viewMonth;
  const isCached = !isActive && cached && `${year}-${month}` === cached.key;
  const hasFullData = isActive || isCached;
  // A non-active month skeletons until its events range is cached.
  const blockSkeleton = isActive ? showGridSkeleton : !monthCached;
  return { isActive, isCached, hasFullData, blockSkeleton };
}
