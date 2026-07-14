import {
  deadlineSearchCandidates,
  normalizeBillSearchCandidate,
  normalizeEventSearchCandidate,
  normalizeLimit,
  rankCalendarSearchCandidates,
} from "./calendar-search.js";
import { addMonthsIso } from "./calendar-range-model.js";

const SEARCH_MIN_QUERY_LENGTH = 2;
const SEARCH_MIRROR_CANDIDATE_LIMIT = 1000;
const SEARCH_HISTORY_MONTHS = 12;
const SEARCH_FUTURE_MONTHS = 18;

function calendarSearchInputError(code, message) {
  const err = new Error(message);
  err.name = "CalendarSearchInputError";
  err.status = 400;
  err.code = code;
  return err;
}

export function isCalendarSearchInputError(err) {
  return err?.name === "CalendarSearchInputError";
}

function cheapEmptyCalendarSearchResponse({ query, scope, limit, fetchedAt }) {
  return {
    query,
    scope,
    limit,
    results: [],
    resultCount: 0,
    totalMatches: 0,
    truncated: false,
    coverage: {
      scope,
      reason: "query_too_short",
      sources: [],
    },
    fetchedAt,
  };
}

function pacificDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
}

function calendarSearchMirrorWindow({ now }) {
  const today = pacificDate(now);
  return {
    start: addMonthsIso(today, -SEARCH_HISTORY_MONTHS),
    end: addMonthsIso(today, SEARCH_FUTURE_MONTHS),
  };
}

function calendarSearchResponse({ query, scope, limit, candidates, coverageSources, now }) {
  const ranked = rankCalendarSearchCandidates(candidates, { query, limit, now });
  return {
    query,
    scope,
    limit,
    results: ranked.results,
    resultCount: ranked.results.length,
    totalMatches: ranked.totalMatches,
    truncated: ranked.truncated,
    coverage: {
      scope,
      sources: coverageSources,
    },
    fetchedAt: now.toISOString(),
  };
}

function shouldRequestCalendarSearchMirrorRepair(syncHealth) {
  return ["initializing", "stale", "degraded", "dirty", "unavailable", "needs_sync"]
    .includes(syncHealth?.state);
}

function calendarSearchMirrorSearched(syncHealth, events) {
  if (events?.length) return true;
  return !["initializing", "unavailable"].includes(syncHealth?.state);
}

export function createCalendarSearchService({
  billMirrorRefreshRange,
  getCalendarSearchMirrorHealth,
  isBillsMirrorMaintenanceDue,
  listCalendarSearchMirrorOccurrences,
  logger = console,
  now = () => new Date(),
  readBillsMirrorRange,
  readCalendarDeadlineRange,
  requestBillsCurrentMaintenanceRefresh,
  requestCalendarSearchMirrorSync,
  scheduleBillsMirrorRefresh,
  shouldScheduleImmediateBillsRefresh,
} = {}) {
  return async function searchCalendar(userId, queryParams = {}) {
    const query = String(queryParams.q || "").trim();
    const scope = String(queryParams.scope || "events").trim();
    const limit = normalizeLimit(queryParams.limit);
    if (scope !== "events" && scope !== "bills") {
      throw calendarSearchInputError(
        "calendar_search_scope_invalid",
        "scope must be events or bills",
      );
    }
    if (limit === null) {
      throw calendarSearchInputError(
        "calendar_search_limit_invalid",
        "limit must be a positive integer",
      );
    }
    if (query.length < SEARCH_MIN_QUERY_LENGTH) {
      return cheapEmptyCalendarSearchResponse({
        query,
        scope,
        limit,
        fetchedAt: now().toISOString(),
      });
    }

    const currentTime = now();
    if (scope === "events") {
      const range = calendarSearchMirrorWindow({ now: currentTime });
      const candidateLimit = Math.max(limit, SEARCH_MIRROR_CANDIDATE_LIMIT);
      const [events, syncHealth, deadlineResult] = await Promise.all([
        listCalendarSearchMirrorOccurrences(userId, {
          start: range.start,
          end: range.end,
          query,
          limit: candidateLimit,
          centerDate: pacificDate(currentTime),
        }),
        getCalendarSearchMirrorHealth(userId),
        readCalendarDeadlineRange(userId, range),
      ]);

      if (shouldRequestCalendarSearchMirrorRepair(syncHealth)) {
        const hasSuccessfulSource = (syncHealth?.sources || [])
          .some((source) => source.lastSuccessAt);
        requestCalendarSearchMirrorSync(userId, {
          reason: `calendar-search-${syncHealth.state}`,
          forceFull: !hasSuccessfulSource,
        });
      }

      return calendarSearchResponse({
        query,
        scope,
        limit,
        candidates: [
          ...events.map((event) => normalizeEventSearchCandidate(event)),
          ...deadlineSearchCandidates(deadlineResult.payload),
        ],
        coverageSources: [
          {
            key: "google_calendar",
            label: "Google Calendar",
            searched: calendarSearchMirrorSearched(syncHealth, events),
            start: range.start,
            end: range.end,
            strategy: "local_mirror",
            syncHealth,
          },
          {
            key: "deadlines",
            label: "Deadline overlays",
            searched: true,
            start: range.start,
            end: range.end,
            errors: deadlineResult.errors || [],
          },
        ],
        now: currentTime,
      });
    }

    const range = billMirrorRefreshRange({ now: currentTime });
    const data = await readBillsMirrorRange(userId, range);
    if (data.syncHealth?.state === "needs_sync") {
      if (shouldScheduleImmediateBillsRefresh(data.syncHealth)) {
        scheduleBillsMirrorRefresh(userId).catch((err) => {
          logger.error("[Calendar] bills mirror refresh scheduling failed:", err.message);
        });
      }
    } else if (isBillsMirrorMaintenanceDue(data.syncHealth)) {
      requestBillsCurrentMaintenanceRefresh(userId, { now: currentTime }).catch((err) => {
        logger.error("[Calendar] bills mirror maintenance refresh scheduling failed:", err.message);
      });
    }

    return calendarSearchResponse({
      query,
      scope,
      limit,
      candidates: (data.schedules || []).map(normalizeBillSearchCandidate),
      coverageSources: [
        {
          key: "bills_mirror",
          label: "Bills mirror",
          searched: true,
          start: range.start,
          end: range.end,
          syncHealth: data.syncHealth || null,
          actualBudgetUrl: data.actualBudgetUrl || null,
          strategy: "local_mirror",
        },
      ],
      now: currentTime,
    });
  };
}

let productionSearchCalendar;

async function loadProductionSearchCalendar() {
  if (productionSearchCalendar) return productionSearchCalendar;
  const [bills, current, deadlines, mirror] = await Promise.all([
    import("../bills/bills-service.js"),
    import("../dashboard/current-service.js"),
    import("../tasks/deadlines-read.js"),
    import("./calendar-search-mirror.js"),
  ]);
  productionSearchCalendar = createCalendarSearchService({
    billMirrorRefreshRange: bills.billMirrorRefreshRange,
    getCalendarSearchMirrorHealth: mirror.getCalendarSearchMirrorHealth,
    isBillsMirrorMaintenanceDue: bills.isBillsMirrorMaintenanceDue,
    listCalendarSearchMirrorOccurrences: mirror.listCalendarSearchMirrorOccurrences,
    readBillsMirrorRange: bills.readBillsMirrorRange,
    readCalendarDeadlineRange: deadlines.readCalendarDeadlineRange,
    requestBillsCurrentMaintenanceRefresh: current.requestBillsCurrentMaintenanceRefresh,
    requestCalendarSearchMirrorSync: mirror.requestCalendarSearchMirrorSync,
    scheduleBillsMirrorRefresh: bills.scheduleBillsMirrorRefresh,
    shouldScheduleImmediateBillsRefresh: bills.shouldScheduleImmediateBillsRefresh,
  });
  return productionSearchCalendar;
}

export async function searchCalendar(...args) {
  const search = await loadProductionSearchCalendar();
  return search(...args);
}
