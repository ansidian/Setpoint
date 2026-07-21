import { useEffect, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  activationTargetFromCalendarSearchResult,
  calendarSearchTodayKey,
  calendarSearchStateLabel,
  calendarSearchStartIndex,
  calendarSearchResultNavigable,
  shouldShowCalendarSearchSkeleton,
} from "../../../hooks/calendar/calendarModalSearchModel";
import type { CalendarSearchResultLike } from "../../../hooks/calendar/calendarModalSearchModel";
import type {
  CalendarModalSearchController,
  CalendarSearchActivationContext,
} from "../../../hooks/calendar/useCalendarModalSearch";
import {
  CalendarSearchRailHeader,
  SearchDateHeader,
  SearchResultRow,
  SearchSkeleton,
} from "./CalendarSearchRailParts";

const SEARCH_RESULT_SCROLL_TOP_OFFSET = 44;

interface CalendarWeatherDay {
  dateKey?: string;
  high?: number | null;
  low?: number | null;
  icon?: string | null;
  summary?: string;
}

export interface CalendarWeatherData extends CalendarWeatherDay {
  temp?: number | null;
  dailyForecast?: CalendarWeatherDay[];
}

interface CalendarWeatherByDate extends CalendarWeatherDay {
  dateKey: string;
}

interface CalendarSearchResultGroup {
  dateKey: string;
  results: Array<{ result: CalendarSearchResultLike; index: number }>;
}

export type CalendarSearchRailController = Omit<CalendarModalSearchController, "activateResult"> & {
  activateResult: (
    result: CalendarSearchResultLike | undefined,
    activationContext?: CalendarSearchActivationContext | null,
  ) => void;
  isResultNavigable?: (result: CalendarSearchResultLike, index?: number) => boolean;
  getResultActivationContext?: (
    result: CalendarSearchResultLike,
    index: number,
    fallback: CalendarSearchActivationContext,
  ) => CalendarSearchActivationContext | null | undefined;
  activateDateHeader?: (dateKey: string) => void;
  selectedItemId?: unknown;
  selectedDateKey?: string | null;
};

function parseDateKey(value: unknown): { year: number; month: number; day: number } | null {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function weatherByDate(
  weatherData: CalendarWeatherData | null,
  todayKey = calendarSearchTodayKey(),
): Map<string, CalendarWeatherByDate> {
  const map = new Map<string, CalendarWeatherByDate>();
  for (const day of weatherData?.dailyForecast || []) {
    if (!day?.dateKey) continue;
    map.set(day.dateKey, {
      dateKey: day.dateKey,
      high: day.high,
      low: day.low,
      icon: day.icon,
      summary: day.summary || "",
    });
  }
  if (
    weatherData
    && todayKey
    && (weatherData.temp != null || weatherData.high != null || weatherData.low != null || weatherData.icon)
  ) {
    map.set(todayKey, {
      ...(map.get(todayKey) || {}),
      dateKey: todayKey,
      high: weatherData.high ?? weatherData.temp ?? null,
      low: weatherData.low ?? weatherData.temp ?? null,
      icon: weatherData.icon,
      summary: weatherData.summary || map.get(todayKey)?.summary || "",
    });
  }
  return map;
}

function groupResultsByDate(results: readonly CalendarSearchResultLike[] = []): CalendarSearchResultGroup[] {
  const groups: CalendarSearchResultGroup[] = [];
  results.forEach((result, index) => {
    const dateKey = result.itemDate || "undated";
    const entry = { result, index };
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.dateKey === dateKey) {
      lastGroup.results.push(entry);
    } else {
      groups.push({ dateKey, results: [entry] });
    }
  });
  return groups;
}

function resultGroupCenterDateKey(
  groups: readonly CalendarSearchResultGroup[],
  todayKey = calendarSearchTodayKey(),
): string | null {
  if (!groups.length) return null;
  const datedGroups = groups.filter((group) => parseDateKey(group.dateKey));
  if (!datedGroups.length) return groups[0]?.dateKey || null;
  const flatResults = groups.flatMap((group) => group.results.map(({ result }) => result));
  const targetIndex = calendarSearchStartIndex(flatResults, todayKey);
  const target = flatResults[targetIndex];
  return target?.itemDate || datedGroups[datedGroups.length - 1]?.dateKey || null;
}

function centerElementInScroller(scroller: HTMLElement | null, element: HTMLElement | null | undefined): number | null {
  if (!scroller || !element) return null;
  const scrollerRect = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const visibleHeight = scroller.clientHeight || scrollerRect.height || 0;
  const nextScrollTop = Math.max(
    0,
    scroller.scrollTop + rect.top - scrollerRect.top - Math.max(0, (visibleHeight - rect.height) / 2),
  );
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: nextScrollTop, behavior: "auto" });
  } else {
    scroller.scrollTop = nextScrollTop;
  }
  return nextScrollTop;
}

function scrollElementNearestInScroller(
  scroller: HTMLElement | null,
  element: HTMLElement | null,
  {
    offsetTop = SEARCH_RESULT_SCROLL_TOP_OFFSET,
    offsetBottom = SEARCH_RESULT_SCROLL_TOP_OFFSET,
  }: { offsetTop?: number; offsetBottom?: number } = {},
): number | null {
  if (!scroller || !element) return null;
  const scrollerRect = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const visibleHeight = scroller.clientHeight || scrollerRect.height || 0;
  if (visibleHeight <= 0) return null;
  const upperEdge = scrollerRect.top + offsetTop;
  const lowerEdge = scrollerRect.bottom - offsetBottom;
  if (rect.top >= upperEdge && rect.bottom <= lowerEdge) return null;
  const rawScrollTop = Math.max(
    0,
    rect.top < upperEdge
      ? scroller.scrollTop + rect.top - upperEdge
      : scroller.scrollTop + rect.bottom - lowerEdge,
  );
  const scrollHeight = scroller.scrollHeight || 0;
  const maxScrollTop = scrollHeight > visibleHeight ? scrollHeight - visibleHeight : rawScrollTop;
  const nextScrollTop = Math.min(rawScrollTop, maxScrollTop);
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const behavior = reduceMotion ? "auto" : "smooth";
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: nextScrollTop, behavior });
  } else {
    scroller.scrollTop = nextScrollTop;
  }
  return nextScrollTop;
}

function resultSource(result: CalendarSearchResultLike): string {
  const payload = result.payload as (typeof result.payload & { source?: unknown }) | undefined;
  const activation = result.activation as (typeof result.activation & { source?: unknown }) | undefined;
  return String(payload?.source || activation?.source || result.coverageKey || "").toLowerCase();
}

function deadlineSelectionIdCandidates(result: CalendarSearchResultLike, dateKey: string): string[] {
  if (result?.type !== "deadline") return [];
  const rawId = result.payload?.id || result.itemId || result.activation?.itemId;
  if (rawId == null) return [];
  const source = resultSource(result);
  const sources = new Set([source].filter(Boolean));
  const id = String(rawId);
  return [...sources].flatMap((sourceKey) => [
    `${sourceKey}:${id}`,
    ...(dateKey ? [`${sourceKey}:${id}-${dateKey}`] : []),
  ]);
}

function resultMatchesSelection(
  result: CalendarSearchResultLike,
  selectedItemId: unknown,
  selectedDateKey: string | null | undefined,
): boolean {
  if (selectedItemId == null || !selectedDateKey) return false;
  const target = activationTargetFromCalendarSearchResult(result);
  if (target?.dateKey !== selectedDateKey) return false;
  if (String(target.itemId) === String(selectedItemId)) return true;
  return deadlineSelectionIdCandidates(result, target.dateKey)
    .some((candidate) => candidate === String(selectedItemId));
}

export default function CalendarSearchRail({
  search,
  layoutMode = "three-rail",
  weatherData = null,
}: {
  search: CalendarSearchRailController;
  layoutMode?: string;
  weatherData?: CalendarWeatherData | null;
}) {
  const inputRef = useAutoFocusInput(search);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const resultRowRefs = useRef(new Map<number, HTMLButtonElement>());
  const headerRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastCenteredSignatureRef = useRef("");
  const stateLabel = calendarSearchStateLabel(search);
  const showSkeleton = shouldShowCalendarSearchSkeleton(search);
  const compact = layoutMode === "stacked-replaces-agenda";
  const resultGroups = groupResultsByDate(search.results);
  const todayKey = calendarSearchTodayKey();
  const weatherMap = weatherByDate(weatherData, todayKey);
  const resultSignature = `${search.query.trim()}|${search.results.map((result) => (
    result.id || `${result.type}-${result.itemId}-${result.itemDate}`
  )).join("|")}`;

  const resultNavigable = (result: CalendarSearchResultLike | undefined, index: number): boolean => {
    if (!result) return false;
    if (!calendarSearchResultNavigable(result)) return false;
    return search.isResultNavigable?.(result, index) ?? true;
  };
  const nextActivationIndex = ({
    highlightedIndex,
    direction,
    includeCurrent,
  }: {
    highlightedIndex: number;
    direction: number;
    includeCurrent: boolean;
  }): number => {
    const count = search.results.length;
    if (!count) return -1;
    const normalized = highlightedIndex < 0 || highlightedIndex >= count ? 0 : highlightedIndex;
    const step = direction >= 0 ? 1 : -1;
    for (let offset = includeCurrent ? 0 : 1; offset <= count; offset += 1) {
      const index = (normalized + (offset * step) + count) % count;
      if (resultNavigable(search.results[index], index)) return index;
    }
    return -1;
  };

  const activateSearchResultAtIndex = (index: number, direction = 1): boolean => {
    const result = search.results[index];
    if (!result) return false;
    const rowElement = resultRowRefs.current.get(index) || null;
    const activationContext = search.getResultActivationContext?.(result, index, {
      anchorElement: rowElement,
      sourceCellElement: rowElement,
    }) || { anchorKind: "grid-chip" };
    search.activateResult(result, activationContext);
    const nextIndex = nextActivationIndex({
      highlightedIndex: index,
      direction,
      includeCurrent: false,
    });
    const highlightedNextIndex = nextIndex >= 0 ? nextIndex : index;
    search.setHighlightedIndex?.(highlightedNextIndex);
    const nextScrollTop = scrollElementNearestInScroller(scrollerRef.current, rowElement);
    if (nextScrollTop != null) search.setScrollTop?.(nextScrollTop);
    return true;
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      const direction = event.shiftKey ? -1 : 1;
      const index = nextActivationIndex({
        highlightedIndex: search.highlightedIndex,
        direction,
        includeCurrent: true,
      });
      if (index >= 0 && activateSearchResultAtIndex(index, direction)) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
    }
    search.handleInputKeyDown(event);
  };

  useLayoutEffect(() => {
    if (search.autoCenterResults === false) return undefined;
    if (!search.open || search.pending || !resultGroups.length) return undefined;
    if (lastCenteredSignatureRef.current === resultSignature) return undefined;
    lastCenteredSignatureRef.current = resultSignature;
    const targetDateKey = resultGroupCenterDateKey(resultGroups);
    const id = window.requestAnimationFrame(() => {
      const targetHeader = targetDateKey ? headerRefs.current.get(targetDateKey) : undefined;
      const nextScrollTop = centerElementInScroller(scrollerRef.current, targetHeader);
      if (nextScrollTop != null) {
        search.setScrollTop?.(nextScrollTop);
        search.markResultsAutoCentered?.();
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [resultGroups, resultSignature, search]);

  useLayoutEffect(() => {
    if (!search.open || search.autoCenterResults !== false) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const nextScrollTop = Number.isFinite(search.scrollTop) ? Math.max(0, search.scrollTop) : 0;
    if (Math.abs(scroller.scrollTop - nextScrollTop) > 1) {
      scroller.scrollTop = nextScrollTop;
    }
  }, [resultSignature, search.autoCenterResults, search.open, search.scrollTop]);

  return (
    <aside
      data-testid="calendar-search-rail"
      data-search-layout={layoutMode}
      data-suspend-calendar-hotkeys="true"
      style={{
        minWidth: 0,
        minHeight: 0,
        height: compact ? "auto" : "100%",
        maxHeight: compact ? 300 : "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.022))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <CalendarSearchRailHeader
        inputRef={inputRef}
        search={search}
        stateLabel={stateLabel}
        onInputKeyDown={handleInputKeyDown}
      />
      <div
        ref={scrollerRef}
        role="listbox"
        aria-label="Calendar search results"
        aria-busy={showSkeleton ? "true" : undefined}
        data-testid="calendar-search-results"
        data-calendar-local-scroll="true"
        onScroll={(event) => search.setScrollTop?.(event.currentTarget.scrollTop)}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: `0 10px ${SEARCH_RESULT_SCROLL_TOP_OFFSET}px`,
          scrollPaddingTop: SEARCH_RESULT_SCROLL_TOP_OFFSET,
          scrollPaddingBottom: SEARCH_RESULT_SCROLL_TOP_OFFSET,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          background: "var(--sp-panel)",
          isolation: "isolate",
        }}
      >
        {showSkeleton ? <SearchSkeleton /> : null}
        {resultGroups.map((group) => (
          <section key={group.dateKey} data-date-key={group.dateKey} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, paddingBottom: 14 }}>
            <SearchDateHeader
              dateKey={group.dateKey}
              todayKey={todayKey}
              weather={weatherMap.get(group.dateKey) || null}
              onActivate={(dateKey) => {
                const firstIndex = group.results[0]?.index;
                if (typeof firstIndex === "number" && Number.isInteger(firstIndex)) {
                  search.setHighlightedIndex?.(firstIndex);
                }
                search.activateDateHeader?.(dateKey);
              }}
              registerHeader={(dateKey, node) => {
                if (node) headerRefs.current.set(dateKey, node);
                else headerRefs.current.delete(dateKey);
              }}
            />
            {group.results.map(({ result, index }) => (
              <SearchResultRow
                key={`${result.id || `${result.type}-${result.itemId}-${result.itemDate}`}:${index}`}
                result={result}
                highlighted={index === search.highlightedIndex}
                selected={resultMatchesSelection(result, search.selectedItemId, search.selectedDateKey)}
                todayKey={todayKey}
                rowRef={(node) => {
                  if (node) resultRowRefs.current.set(index, node);
                  else resultRowRefs.current.delete(index);
                }}
                onActivate={(event) => search.activateResult(result, {
                  anchorElement: event.currentTarget,
                  sourceCellElement: event.currentTarget,
                  anchorKind: "search-result-row",
                })}
              />
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

function useAutoFocusInput(search: CalendarSearchRailController) {
  const ref = useRef<HTMLInputElement | null>(null);
  const previousScopeRef = useRef(search.scope);
  const previousFocusRequestIdRef = useRef(0);

  useEffect(() => {
    if (!search.open || !search.focusRequestId) return;
    const scopeChanged = previousScopeRef.current && previousScopeRef.current !== search.scope;
    const focusRequested = previousFocusRequestIdRef.current !== search.focusRequestId;
    previousScopeRef.current = search.scope;
    previousFocusRequestIdRef.current = search.focusRequestId;
    if (!scopeChanged && !focusRequested) return;
    ref.current?.focus();
    if (!scopeChanged && search.focusSelectAll !== false) ref.current?.select?.();
    else {
      const valueLength = ref.current?.value?.length || 0;
      ref.current?.setSelectionRange?.(valueLength, valueLength);
    }
  }, [search.focusRequestId, search.focusSelectAll, search.open, search.scope]);
  return ref;
}
