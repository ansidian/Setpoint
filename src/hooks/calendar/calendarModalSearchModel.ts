import type { CalendarSearchResult, CalendarView } from "../../../shared/types/calendar";

export type CalendarSearchScope = "events" | "bills";
export type CalendarSearchResultLike = Omit<Partial<CalendarSearchResult>, "activation"> & {
  hidden?: boolean;
  isHidden?: boolean;
  disabled?: boolean;
  visible?: boolean;
  isVisible?: boolean;
  activation?: (Partial<CalendarSearchResult["activation"]> & {
    hidden?: boolean;
    disabled?: boolean;
    visible?: boolean;
    available?: boolean;
  });
};

interface CalendarSearchCoverageSource {
  key: string;
  syncHealth?: { state?: string | null } | null;
}

interface CalendarSearchCoverage {
  sources?: CalendarSearchCoverageSource[];
}

export type CalendarSearchKeyAction =
  | { type: "highlight"; index: number }
  | { type: "activate"; index: number; nextIndex: number }
  | { type: "clear" | "close" | "none" };

export interface CalendarSearchActivationTarget {
  view: CalendarView;
  detailKind?: "deadline";
  dateKey: string;
  itemId: string;
}

export function searchScopeForCalendarView(view: unknown): CalendarSearchScope {
  return view === "bills" ? "bills" : "events";
}

const MIN_QUERY_LENGTH = 2;
const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";

export function calendarSearchTodayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function normalizedCalendarSearchQuery(query: unknown = ""): string {
  return String(query || "").trim().toLocaleLowerCase();
}

export function calendarSearchPlaceholder(scope: CalendarSearchScope = "events"): string {
  return scope === "bills" ? "Search bills" : "Search events and deadlines";
}

export function shouldShowCalendarSearchSkeleton({
  query = "",
  pending = false,
  results = [],
}: { query?: unknown; pending?: boolean; results?: readonly unknown[] | null } = {}): boolean {
  return !!pending && normalizedCalendarSearchQuery(query).length >= MIN_QUERY_LENGTH && !(results || []).length;
}

function sourceCoverage(coverage: CalendarSearchCoverage | null | undefined, key: string): CalendarSearchCoverageSource | null {
  return coverage?.sources?.find((source) => source.key === key) || null;
}

function googleCalendarCoverageState(coverage: CalendarSearchCoverage | null | undefined): string | null {
  return sourceCoverage(coverage, "google_calendar")?.syncHealth?.state || null;
}

function isGoogleCalendarCoverageLimited(coverage: CalendarSearchCoverage | null | undefined): boolean {
  const state = googleCalendarCoverageState(coverage);
  return state != null && ["initializing", "unavailable"].includes(state);
}

function isGoogleCalendarCoverageAged(coverage: CalendarSearchCoverage | null | undefined): boolean {
  const state = googleCalendarCoverageState(coverage);
  return state != null && ["stale", "degraded", "dirty", "needs_sync"].includes(state);
}

function hasOnlyDeadlineResults(results: readonly CalendarSearchResultLike[] | null | undefined): boolean {
  const visibleResults = Array.isArray(results) ? results : [];
  return visibleResults.length > 0 && visibleResults.every((result) => result?.type === "deadline");
}

export function calendarSearchStateLabel({
  scope = "events",
  query = "",
  pending = false,
  results = [],
  error = null,
  truncated = false,
  coverage = null,
}: {
  scope?: CalendarSearchScope;
  query?: unknown;
  pending?: boolean;
  results?: readonly CalendarSearchResultLike[] | null;
  error?: unknown;
  truncated?: boolean;
  coverage?: CalendarSearchCoverage | null;
} = {}): string {
  const trimmed = String(query || "").trim();
  const visibleResults = Array.isArray(results) ? results : [];
  if (error) return "Search unavailable";
  if (trimmed.length < MIN_QUERY_LENGTH) return "Type 2 characters";
  if (pending && visibleResults.length) return "Updating";
  if (pending) return "Searching";
  if (scope === "events" && isGoogleCalendarCoverageLimited(coverage)) {
    return hasOnlyDeadlineResults(visibleResults) ? "Partial results: deadlines only" : "Calendar events indexing";
  }
  if (scope === "events" && isGoogleCalendarCoverageAged(coverage)) {
    return visibleResults.length ? "Showing available results" : "No matches in available results";
  }
  if (!visibleResults.length) return scope === "bills" ? "No bills found" : "No events or deadlines found";
  if (truncated) return "Limited results";
  const mirror = sourceCoverage(coverage, "bills_mirror");
  if (mirror) return "Bills mirror";
  return "";
}

export function nextCalendarSearchHighlight({
  currentIndex = -1,
  resultCount = 0,
  direction = 1,
  results = null,
  includeCurrent = false,
}: {
  currentIndex?: number;
  resultCount?: number;
  direction?: number;
  results?: readonly CalendarSearchResultLike[] | null;
  includeCurrent?: boolean;
} = {}): number {
  const count = Array.isArray(results) ? results.length : resultCount;
  if (!count) return -1;
  const normalized = currentIndex < 0 || currentIndex >= count ? 0 : currentIndex;
  const step = direction >= 0 ? 1 : -1;
  for (let offset = includeCurrent ? 0 : 1; offset <= count; offset += 1) {
    const index = (normalized + (offset * step) + count) % count;
    if (!Array.isArray(results) || calendarSearchResultNavigable(results[index])) return index;
  }
  return -1;
}

export function calendarSearchStartIndex(
  results: readonly CalendarSearchResultLike[] = [],
  todayKey = calendarSearchTodayKey(),
): number {
  const items = (Array.isArray(results) ? results : [])
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => calendarSearchResultNavigable(result));
  if (!items.length) return -1;

  let upcoming: { dateKey: string; index: number } | null = null;
  let past: { dateKey: string; index: number } | null = null;
  for (const { result, index } of items) {
    const dateKey = result?.itemDate;
    if (!dateKey) continue;
    if (dateKey >= todayKey) {
      if (!upcoming || dateKey < upcoming.dateKey || (dateKey === upcoming.dateKey && index < upcoming.index)) {
        upcoming = { dateKey, index };
      }
      continue;
    }
    if (!past || dateKey > past.dateKey || (dateKey === past.dateKey && index > past.index)) {
      past = { dateKey, index };
    }
  }

  return upcoming?.index ?? past?.index ?? 0;
}

export function calendarSearchResultNavigable(result: CalendarSearchResultLike | null | undefined): boolean {
  if (!result) return false;
  if (result.hidden || result.isHidden || result.disabled) return false;
  if (result.visible === false || result.isVisible === false) return false;
  const activation = result.activation ?? {};
  if (activation.hidden || activation.disabled) return false;
  if (activation.visible === false || activation.available === false) return false;
  return true;
}

export function nextCalendarSearchActivationIndex({
  results = [],
  highlightedIndex = -1,
  direction = 1,
  includeCurrent = true,
}: {
  results?: readonly CalendarSearchResultLike[];
  highlightedIndex?: number;
  direction?: number;
  includeCurrent?: boolean;
} = {}): number {
  return nextCalendarSearchHighlight({
    currentIndex: highlightedIndex,
    resultCount: Array.isArray(results) ? results.length : 0,
    direction,
    results,
    includeCurrent,
  });
}

export function calendarSearchKeyAction({
  key,
  shiftKey = false,
  query = "",
  highlightedIndex = -1,
  resultCount = 0,
  results = null,
}: {
  key?: string;
  shiftKey?: boolean;
  query?: string;
  highlightedIndex?: number;
  resultCount?: number;
  results?: readonly CalendarSearchResultLike[] | null;
} = {}): CalendarSearchKeyAction {
  if (key === "ArrowDown") {
    return {
      type: "highlight",
      index: nextCalendarSearchHighlight({ currentIndex: highlightedIndex, resultCount, direction: 1, results }),
    };
  }
  if (key === "ArrowUp") {
    return {
      type: "highlight",
      index: nextCalendarSearchHighlight({ currentIndex: highlightedIndex, resultCount, direction: -1, results }),
    };
  }
  const activateIndex = nextCalendarSearchActivationIndex({
    results: Array.isArray(results) ? results as CalendarSearchResultLike[] : undefined,
    highlightedIndex,
    direction: shiftKey ? -1 : 1,
    includeCurrent: true,
  });
  if (
    key === "Enter"
    && highlightedIndex >= 0
    && highlightedIndex < resultCount
    && (!Array.isArray(results) || activateIndex >= 0)
  ) {
    const index = Array.isArray(results) ? activateIndex : highlightedIndex;
    return {
      type: "activate",
      index,
      nextIndex: nextCalendarSearchHighlight({
        currentIndex: index,
        resultCount,
        direction: shiftKey ? -1 : 1,
        results,
      }),
    };
  }
  if (key === "Escape") {
    return query ? { type: "clear" } : { type: "close" };
  }
  return { type: "none" };
}

export function activationTargetFromCalendarSearchResult(
  result: CalendarSearchResultLike | null | undefined,
): CalendarSearchActivationTarget | null {
  const activation: NonNullable<CalendarSearchResultLike["activation"]> = result?.activation ?? {};
  const dateKey = activation.dateKey || result?.itemDate || null;
  const itemId = activation.itemId || result?.itemId || null;
  if (!dateKey || !itemId) return null;
  const detailKind = activation.detailKind || (result?.type === "deadline" ? "deadline" : null);
  return {
    view: activation.view || (result?.type === "bill" ? "bills" : "events"),
    ...(detailKind ? { detailKind } : {}),
    dateKey,
    itemId: String(itemId),
  };
}
