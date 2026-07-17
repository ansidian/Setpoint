import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { monthBounds } from "./calendarRangeModel";
import {
  agendaMonthRange,
  initialAgendaMonths,
  computeAgendaFetchPlan,
  computeAgendaJumpPlan,
  pruneAgendaMonths,
} from "./agendaFetchModel";
import type { AgendaMonthRange } from "./agendaFetchModel";

export interface AgendaRangeController {
  ensureRange(start: string, end: string): Promise<unknown>;
  hasMonth?(year: number, month: number): boolean;
}

export interface UseAgendaFetchOptions {
  topmostMonth?: string | null;
  pendingTargetMonth?: string | null;
  domainRange: AgendaRangeController | null | undefined;
  deadlinesRange?: AgendaRangeController | null;
  todayKey: string;
  disabled?: boolean;
}

export interface AgendaFetchController {
  loadedMonths: string[];
  totalRange: AgendaMonthRange;
  initialReady: boolean;
}

export function useAgendaFetch({
  topmostMonth = null,
  pendingTargetMonth = null,
  domainRange,
  deadlinesRange = null,
  todayKey,
  disabled = false,
}: UseAgendaFetchOptions): AgendaFetchController {
  const totalRange = useMemo(() => agendaMonthRange(todayKey), [todayKey]);
  const loadedRef = useRef<string[]>([]);
  const fetchGenRef = useRef(0);
  const [loadedMonths, setLoadedMonths] = useState<string[]>([]);
  const [initialReady, setInitialReady] = useState(false);
  const domainRangeRef = useRef(domainRange);
  const deadlinesRangeRef = useRef(deadlinesRange);
  const pendingTargetMonthRef = useRef(pendingTargetMonth);
  const anchorMonthRef = useRef<string | null>(null);
  useEffect(() => {
    domainRangeRef.current = domainRange;
    deadlinesRangeRef.current = deadlinesRange;
    pendingTargetMonthRef.current = pendingTargetMonth;
    anchorMonthRef.current = pendingTargetMonth || topmostMonth || anchorMonthRef.current;
  });

  const applyLoaded = useCallback((months: string[], { reset = false }: { reset?: boolean } = {}) => {
    const set = new Set<string>(reset ? [] : loadedRef.current);
    let changed = reset;
    for (const m of months) {
      if (!set.has(m)) { set.add(m); changed = true; }
    }
    if (!changed) return;
    const merged = [...set].sort();
    // Reset windows are already minimal; pruning only applies to incremental
    // growth, which is what accumulates without bound during sustained scroll.
    const next = reset
      ? merged
      : pruneAgendaMonths({ anchorMonth: anchorMonthRef.current, loadedMonths: merged });
    const previous = loadedRef.current;
    if (next.length === previous.length && next.every((m, i) => m === previous[i])) return;
    loadedRef.current = next;
    setLoadedMonths(next);
  }, []);

  const fetchMonths = useCallback(async (months: string[], { reset = false }: { reset?: boolean } = {}): Promise<void> => {
    if (!months.length || !domainRangeRef.current?.ensureRange) return;
    // A reset starts a new generation; in-flight fetches from older
    // generations must not merge their months back into the fresh window.
    if (reset) fetchGenRef.current += 1;
    const generation = fetchGenRef.current;
    const { start } = monthBounds(months[0]!);
    const { end } = monthBounds(months[months.length - 1]!);
    try {
      const requests: Promise<unknown>[] = [domainRangeRef.current.ensureRange(start, end)];
      if (deadlinesRangeRef.current?.ensureRange) {
        requests.push(deadlinesRangeRef.current.ensureRange(start, end));
      }
      await Promise.all(requests);
    } catch {
      // The domain range hooks rethrow fetch failures. Failed months stay
      // out of loadedMonths so a later plan run retries them; callers (the
      // initial effect included) treat resolution as "the attempt finished",
      // not "the data arrived".
      return;
    }
    if (generation !== fetchGenRef.current) return;
    // Resolution is not proof of data: a pass that inherited an aborted
    // shared fetch resolves without the cache gaining its months. Only
    // record months the events cache actually has; later plan runs retry
    // the rest.
    const hasMonth = domainRangeRef.current.hasMonth;
    const confirmed = hasMonth
      ? months.filter((m) => hasMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1))
      : months;
    if (!confirmed.length) return;
    applyLoaded(confirmed, { reset });
  }, [applyLoaded]);

  useEffect(() => {
    if (disabled) return;
    const initial = initialAgendaMonths(todayKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates happen after await inside fetchMonths/then, not synchronously; the rule cannot trace through the async boundary
    fetchMonths(initial).then(() => {
      setInitialReady(true);
      // A scroll command may have arrived while the initial window loaded;
      // plan for it now that there is a loaded window to extend or reset.
      const targetMonth = pendingTargetMonthRef.current;
      if (!targetMonth) return;
      const plan = computeAgendaJumpPlan({
        targetMonth,
        loadedMonths: loadedRef.current,
        totalRange,
      });
      if (plan.needed.length) {
        fetchMonths(plan.needed, { reset: plan.reset });
      }
    });
  }, [disabled, todayKey, fetchMonths, totalRange]);

  useEffect(() => {
    if (disabled || !topmostMonth || !loadedRef.current.length) return;
    const plan = computeAgendaFetchPlan({
      topmostMonth,
      loadedMonths: loadedRef.current,
      totalRange,
      threshold: 2,
    });
    if (plan.needed.length) {
      fetchMonths(plan.needed);
    }
  }, [disabled, topmostMonth, totalRange, fetchMonths]);

  // Explicit navigation (month picker, prev/next, grid-driven sync) targets a
  // month directly; make sure it is loaded so the pending scroll command can
  // land. Far targets reset the window so the rail never renders a seam.
  useEffect(() => {
    if (disabled || !pendingTargetMonth || !loadedRef.current.length) return;
    const plan = computeAgendaJumpPlan({
      targetMonth: pendingTargetMonth,
      loadedMonths: loadedRef.current,
      totalRange,
    });
    if (plan.needed.length) {
      fetchMonths(plan.needed, { reset: plan.reset });
    }
  }, [disabled, pendingTargetMonth, totalRange, fetchMonths]);

  return { loadedMonths, totalRange, initialReady };
}
