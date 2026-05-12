export function searchScopeForCalendarView(view) {
  return view === "bills" ? "bills" : "events";
}

const MIN_QUERY_LENGTH = 2;
const DASHBOARD_CALENDAR_TZ = "America/Los_Angeles";

export function calendarSearchTodayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function normalizedCalendarSearchQuery(query = "") {
  return String(query || "").trim().toLocaleLowerCase();
}

export function calendarSearchPlaceholder(scope = "events") {
  return scope === "bills" ? "Search bills" : "Search events and deadlines";
}

export function shouldShowCalendarSearchSkeleton({
  query = "",
  pending = false,
  results = [],
} = {}) {
  return !!pending && normalizedCalendarSearchQuery(query).length >= MIN_QUERY_LENGTH && !(results || []).length;
}

function sourceCoverage(coverage, key) {
  return coverage?.sources?.find((source) => source.key === key) || null;
}

function googleCalendarCoverageState(coverage) {
  return sourceCoverage(coverage, "google_calendar")?.syncHealth?.state || null;
}

function isGoogleCalendarCoverageLimited(coverage) {
  return ["initializing", "unavailable"].includes(googleCalendarCoverageState(coverage));
}

function isGoogleCalendarCoverageAged(coverage) {
  return ["stale", "degraded", "dirty", "needs_sync"].includes(googleCalendarCoverageState(coverage));
}

function hasOnlyDeadlineResults(results) {
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
} = {}) {
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
} = {}) {
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

export function calendarSearchStartIndex(results = [], todayKey = calendarSearchTodayKey()) {
  const items = (Array.isArray(results) ? results : [])
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => calendarSearchResultNavigable(result));
  if (!items.length) return -1;

  let upcoming = null;
  let past = null;
  items.forEach(({ result, index }) => {
    const dateKey = result?.itemDate;
    if (!dateKey) return;
    if (dateKey >= todayKey) {
      if (!upcoming || dateKey < upcoming.dateKey || (dateKey === upcoming.dateKey && index < upcoming.index)) {
        upcoming = { dateKey, index };
      }
      return;
    }
    if (!past || dateKey > past.dateKey || (dateKey === past.dateKey && index > past.index)) {
      past = { dateKey, index };
    }
  });

  return upcoming?.index ?? past?.index ?? 0;
}

export function calendarSearchResultNavigable(result) {
  if (!result) return false;
  if (result.hidden || result.isHidden || result.disabled) return false;
  if (result.visible === false || result.isVisible === false) return false;
  const activation = result.activation || {};
  if (activation.hidden || activation.disabled) return false;
  if (activation.visible === false || activation.available === false) return false;
  return true;
}

export function nextCalendarSearchActivationIndex({
  results = [],
  highlightedIndex = -1,
  direction = 1,
  includeCurrent = true,
} = {}) {
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
} = {}) {
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
    results: Array.isArray(results) ? results : null,
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

export function activationTargetFromCalendarSearchResult(result) {
  const activation = result?.activation || {};
  const dateKey = activation.dateKey || result?.itemDate || null;
  const itemId = activation.itemId || result?.itemId || null;
  if (!dateKey || !itemId) return null;
  return {
    view: activation.view || (result?.type === "bill" ? "bills" : "events"),
    detailView: activation.detailView || (result?.type === "deadline" ? "deadlines" : result?.type || null),
    dateKey,
    itemId: String(itemId),
  };
}
