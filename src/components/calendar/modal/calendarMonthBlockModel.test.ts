import { describe, expect, it } from "vitest";
import { resolveMonthBlockState } from "./calendarMonthBlockModel";

const base = {
  year: 2026,
  month: 5,
  viewYear: 2026,
  viewMonth: 4,
  cached: null,
  monthCached: false,
  showGridSkeleton: false,
};

describe("resolveMonthBlockState", () => {
  it("flags the active month and uses the active skeleton flag for it", () => {
    const result = resolveMonthBlockState({
      ...base, year: 2026, month: 4, showGridSkeleton: true,
    });
    expect(result.isActive).toBe(true);
    expect(result.hasFullData).toBe(true);
    expect(result.blockSkeleton).toBe(true); // active month follows showGridSkeleton
  });

  it("never marks the active month as cached, even if its key matches a cached entry", () => {
    // Pins the `!isActive` guard: the active month is full-data via isActive, not isCached.
    const result = resolveMonthBlockState({
      ...base, year: 2026, month: 4, cached: { key: "2026-4" },
    });
    expect(result.isActive).toBe(true);
    expect(result.isCached).toBe(false);
  });

  it("uses the active skeleton flag (not a forced true) for the active month", () => {
    // Pins the active branch of `isActive ? showGridSkeleton : !monthCached`.
    const result = resolveMonthBlockState({
      ...base, year: 2026, month: 4, showGridSkeleton: false, monthCached: false,
    });
    expect(result.isActive).toBe(true);
    expect(result.blockSkeleton).toBe(false);
  });

  it("flags the previously-active month as cached (full data, no skeleton from monthCached)", () => {
    const result = resolveMonthBlockState({
      ...base, year: 2026, month: 3, cached: { key: "2026-3" }, monthCached: false,
    });
    expect(result.isActive).toBe(false);
    expect(result.isCached).toBe(true);
    expect(result.hasFullData).toBe(true);
  });

  it("does not treat a non-matching cached key as cached", () => {
    const result = resolveMonthBlockState({
      ...base, year: 2026, month: 6, cached: { key: "2026-3" },
    });
    expect(result.isCached).toBe(false);
    expect(result.hasFullData).toBe(false);
  });

  it("shows a skeleton for a non-active, uncached month and hides it when cached by month", () => {
    expect(resolveMonthBlockState({ ...base, monthCached: false }).blockSkeleton).toBe(true);
    expect(resolveMonthBlockState({ ...base, monthCached: true }).blockSkeleton).toBe(false);
  });

  it("never skeletons a non-active month in a month-agnostic (shared itemsByDate) view", () => {
    // Bills share one date-keyed map across all mounted months (monthAgnosticItemsByDate),
    // so a non-active bills month already has its chips — it must not paint a skeleton over
    // them just because the EVENTS range cache lacks that month.
    const shared = resolveMonthBlockState({ ...base, monthCached: false, shareItemsByDate: true });
    expect(shared.isActive).toBe(false);
    expect(shared.blockSkeleton).toBe(false);
    // Events (no shared map) still skeleton an uncached non-active month.
    expect(resolveMonthBlockState({ ...base, monthCached: false, shareItemsByDate: false }).blockSkeleton).toBe(true);
  });

  it("keeps isCached/hasFullData falsy (the raw operand, not coerced) when there is no cached entry", () => {
    // `!isActive && cached && ...` short-circuits to the falsy `cached` (null);
    // `isActive || isCached` then yields null too. The render reads both only in
    // boolean context, so the falsy operand is preserved rather than coerced.
    const result = resolveMonthBlockState({ ...base, cached: null });
    expect(result.isCached).toBeFalsy();
    expect(result.hasFullData).toBeFalsy();
  });
});
