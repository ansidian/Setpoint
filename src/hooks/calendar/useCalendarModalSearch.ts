import { useCallback, useEffect, useRef, useState } from "react";
import { getCalendarSearch } from "../../api";
import {
  calendarSearchKeyAction,
  type CalendarSearchResultLike,
  type CalendarSearchScope,
  calendarSearchStartIndex,
  normalizedCalendarSearchQuery,
  searchScopeForCalendarView,
} from "./calendarModalSearchModel";

const DEFAULT_LIMIT = 50;
const DEFAULT_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const SEARCH_SCOPES: CalendarSearchScope[] = ["events", "bills"];

export interface CalendarSearchCoverage {
  sources?: Array<{ key: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface CalendarSearchSnapshot {
  query: string;
  results: CalendarSearchResultLike[];
  coverage: CalendarSearchCoverage | null;
  pending: boolean;
  error: unknown;
  highlightedIndex: number;
  truncated: boolean;
  scrollTop: number;
  autoCenterResults: boolean;
  autoCenterAfterFetch: boolean;
}

export interface CalendarSearchPayload {
  results?: CalendarSearchResultLike[];
  coverage?: CalendarSearchCoverage;
  truncated?: boolean;
}

export interface CalendarSearchRequest {
  scope?: CalendarSearchScope;
  q?: string;
  limit?: number;
  signal?: AbortSignal;
}

export type CalendarSearchApi = (request: CalendarSearchRequest) => Promise<CalendarSearchPayload>;

export interface CalendarSearchActivationContext {
  anchorElement?: Element | null;
  sourceCellElement?: Element | null;
  anchorKind?: string;
}

export interface CalendarModalSearchOptions {
  modalOpen?: boolean;
  view?: string;
  searchApi?: CalendarSearchApi;
  onActivateResult?: (result: CalendarSearchResultLike, context?: CalendarSearchActivationContext) => unknown;
  debounceMs?: number;
  limit?: number;
}

function emptySearchSnapshot(): CalendarSearchSnapshot {
  return {
    query: "",
    results: [],
    coverage: null,
    pending: false,
    error: null,
    highlightedIndex: -1,
    truncated: false,
    scrollTop: 0,
    autoCenterResults: false,
    autoCenterAfterFetch: false,
  };
}

function initialSearchSnapshots(): Record<CalendarSearchScope, CalendarSearchSnapshot> {
  return SEARCH_SCOPES.reduce((acc, key) => {
    acc[key] = emptySearchSnapshot();
    return acc;
  }, {} as Record<CalendarSearchScope, CalendarSearchSnapshot>);
}

function resultStableId(result?: CalendarSearchResultLike) {
  return result?.id || `${result?.type || "result"}:${result?.itemId || ""}:${result?.itemDate || ""}`;
}

export default function useCalendarModalSearch({
  modalOpen,
  view,
  searchApi = (request) => getCalendarSearch(request) as Promise<CalendarSearchPayload>,
  onActivateResult,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  limit = DEFAULT_LIMIT,
}: CalendarModalSearchOptions = {}) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState(initialSearchSnapshots);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [focusSelectAll, setFocusSelectAll] = useState(false);
  const requestSeqRef = useRef<Record<CalendarSearchScope, number>>({ events: 0, bills: 0 });
  const abortControllersRef = useRef<Record<CalendarSearchScope, AbortController | null>>({ events: null, bills: null });
  const snapshotsRef = useRef(snapshots);

  const scope = searchScopeForCalendarView(view);
  const activeSnapshot = snapshots[scope] || emptySearchSnapshot();
  const {
    query,
    results,
    coverage,
    pending,
    error,
    highlightedIndex,
    truncated,
    scrollTop,
    autoCenterResults,
  } = activeSnapshot;

  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);

  useEffect(() => () => {
    for (const controller of Object.values(abortControllersRef.current)) {
      controller?.abort();
    }
  }, []);

  const updateSnapshot = useCallback((targetScope: CalendarSearchScope, updater: Partial<CalendarSearchSnapshot> | ((snapshot: CalendarSearchSnapshot) => Partial<CalendarSearchSnapshot> | CalendarSearchSnapshot)) => {
    setSnapshots((current) => {
      const previous = current[targetScope] || emptySearchSnapshot();
      const next = typeof updater === "function" ? updater(previous) : updater;
      if (next === previous) return current;
      return {
        ...current,
        [targetScope]: {
          ...previous,
          ...next,
        },
      };
    });
  }, []);

  const setImmediateResults = useCallback((nextResults: CalendarSearchResultLike[]) => {
    const normalized = Array.isArray(nextResults) ? nextResults : [];
    updateSnapshot(scope, {
      results: normalized,
      highlightedIndex: calendarSearchStartIndex(normalized),
      autoCenterResults: false,
    });
  }, [scope, updateSnapshot]);

  const setQuery = useCallback((nextQuery: string | ((query: string) => string)) => {
    updateSnapshot(scope, (current) => {
      const resolved = typeof nextQuery === "function" ? nextQuery(current.query) : nextQuery;
      const rawQuery = String(resolved || "");
      const currentNormalized = normalizedCalendarSearchQuery(current.query);
      const nextNormalized = normalizedCalendarSearchQuery(rawQuery);
      if (current.query === rawQuery) return current;
      if (currentNormalized === nextNormalized) {
        return { query: rawQuery };
      }
      requestSeqRef.current[scope] = (requestSeqRef.current[scope] || 0) + 1;
      return {
        query: rawQuery,
        results: [],
        coverage: null,
        pending: false,
        error: null,
        highlightedIndex: -1,
        truncated: false,
        scrollTop: 0,
        autoCenterResults: false,
        autoCenterAfterFetch: nextNormalized.length >= MIN_QUERY_LENGTH,
      };
    });
  }, [scope, updateSnapshot]);

  const clearQuery = useCallback(() => {
    requestSeqRef.current[scope] = (requestSeqRef.current[scope] || 0) + 1;
    updateSnapshot(scope, emptySearchSnapshot());
  }, [scope, updateSnapshot]);

  const openSearch = useCallback((options: { selectAll?: boolean } = {}) => {
    const selectAll = options.selectAll ?? true;
    setOpen(true);
    setFocusSelectAll(selectAll);
    setFocusRequestId((value) => value + 1);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setFocusSelectAll(false);
    setFocusRequestId(0);
  }, []);

  const cancelSearch = useCallback(() => {
    if (!open) return false;
    if (query) clearQuery();
    else closeSearch();
    return true;
  }, [clearQuery, closeSearch, open, query]);

  const activateResult = useCallback((result: CalendarSearchResultLike | undefined, activationContext: CalendarSearchActivationContext | null = null) => {
    if (!result) return;
    if (activationContext) onActivateResult?.(result, activationContext);
    else onActivateResult?.(result);
  }, [onActivateResult]);

  const activateHighlighted = useCallback(() => {
    activateResult(results[highlightedIndex]);
  }, [activateResult, highlightedIndex, results]);

  const setHighlightedIndex = useCallback((nextIndex: number | ((index: number) => number)) => {
    updateSnapshot(scope, (current) => ({
      highlightedIndex: typeof nextIndex === "function" ? nextIndex(current.highlightedIndex) : nextIndex,
    }));
  }, [scope, updateSnapshot]);

  const setScrollTop = useCallback((nextScrollTop: number | ((scrollTop: number) => number)) => {
    updateSnapshot(scope, (current) => {
      const resolved = typeof nextScrollTop === "function" ? nextScrollTop(current.scrollTop) : nextScrollTop;
      const numeric = Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
      return {
        scrollTop: numeric,
        autoCenterResults: current.pending ? false : current.autoCenterResults,
      };
    });
  }, [scope, updateSnapshot]);

  const markResultsAutoCentered = useCallback(() => {
    updateSnapshot(scope, { autoCenterResults: false });
  }, [scope, updateSnapshot]);

  const handleInputKeyDown = useCallback((event: { key: string; shiftKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void }) => {
    const action = calendarSearchKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      query,
      highlightedIndex,
      resultCount: results.length,
      results,
    });
    if (action.type === "none") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (action.type === "highlight") {
      setHighlightedIndex(action.index);
    } else if (action.type === "activate") {
      activateResult(results[action.index]);
      if (Number.isInteger(action.nextIndex)) setHighlightedIndex(action.nextIndex);
    } else if (action.type === "clear") {
      clearQuery();
    } else if (action.type === "close") {
      closeSearch();
    }
  }, [activateResult, clearQuery, closeSearch, highlightedIndex, query, results, setHighlightedIndex]);

  useEffect(() => {
    if (modalOpen) return undefined;
    const timerId = window.setTimeout(() => {
      for (const searchScope of SEARCH_SCOPES) {
        abortControllersRef.current[searchScope]?.abort();
        abortControllersRef.current[searchScope] = null;
      }
      const nextSnapshots = initialSearchSnapshots();
      setOpen(false);
      setSnapshots(nextSnapshots);
      requestSeqRef.current = { events: 0, bills: 0 };
      snapshotsRef.current = nextSnapshots;
      setFocusRequestId(0);
      setFocusSelectAll(false);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen || !open) return undefined;
    const controllers = abortControllersRef.current;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestSeqRef.current[scope] = (requestSeqRef.current[scope] || 0) + 1;
      controllers[scope]?.abort();
      controllers[scope] = null;
      const shortQueryTimerId = window.setTimeout(() => {
        updateSnapshot(scope, (current) => ({
          pending: false,
          results: current.results.length ? [] : current.results,
          coverage: null,
          error: null,
          highlightedIndex: -1,
          truncated: false,
          autoCenterResults: false,
          autoCenterAfterFetch: false,
        }));
      }, 0);
      return () => window.clearTimeout(shortQueryTimerId);
    }

    const requestId = (requestSeqRef.current[scope] || 0) + 1;
    requestSeqRef.current[scope] = requestId;
    let effectController: AbortController | null = null;
    const timerId = window.setTimeout(() => {
      updateSnapshot(scope, { pending: true, error: null });
      controllers[scope]?.abort();
      const controller = new AbortController();
      effectController = controller;
      controllers[scope] = controller;
      searchApi({ scope, q: trimmed, limit, signal: controller.signal })
        .then((payload) => {
          const currentSnapshot = snapshotsRef.current[scope] || emptySearchSnapshot();
          if (
            requestSeqRef.current[scope] !== requestId
            || currentSnapshot.query.trim() !== trimmed
          ) {
            return;
          }
          const nextResults = Array.isArray(payload?.results) ? payload.results : [];
          updateSnapshot(scope, (current) => {
            const highlighted = current.results[current.highlightedIndex];
            const highlightedId = resultStableId(highlighted);
            const preservedIndex = highlightedId
              ? nextResults.findIndex((item) => resultStableId(item) === highlightedId)
              : -1;
            return {
              results: nextResults,
              coverage: payload?.coverage || null,
              truncated: !!payload?.truncated,
              highlightedIndex: preservedIndex >= 0 ? preservedIndex : calendarSearchStartIndex(nextResults),
              autoCenterResults: !!current.autoCenterAfterFetch,
              autoCenterAfterFetch: false,
            };
          });
        })
        .catch((err: unknown) => {
          if (typeof err === "object" && err !== null && "name" in err && err.name === "AbortError") return;
          if (requestSeqRef.current[scope] !== requestId) return;
          updateSnapshot(scope, { error: err });
        })
        .finally(() => {
          if (requestSeqRef.current[scope] === requestId) updateSnapshot(scope, { pending: false });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timerId);
      effectController?.abort();
      if (controllers[scope] === effectController) {
        controllers[scope] = null;
      }
    };
  }, [debounceMs, limit, modalOpen, open, query, scope, searchApi, updateSnapshot]);

  return {
    open,
    query,
    setQuery,
    clearQuery,
    closeSearch,
    cancelSearch,
    openSearch,
    focusRequestId,
    focusSelectAll,
    scope,
    results,
    setImmediateResults,
    coverage,
    pending,
    error,
    highlightedIndex,
    setHighlightedIndex,
    scrollTop,
    setScrollTop,
    autoCenterResults,
    markResultsAutoCentered,
    truncated,
    handleInputKeyDown,
    activateHighlighted,
    activateResult,
  };
}

export type CalendarModalSearchController = ReturnType<typeof useCalendarModalSearch>;
