import {
  deadlineSearchCandidates,
  normalizeEventSearchCandidate,
  normalizeLimit,
  rankCalendarSearchCandidates,
} from "./calendar-search.ts";
import { addMonthsIso } from "./calendar-range-model.ts";
import type {
  CalendarSearchCandidate,
} from "../../shared/types/calendar.ts";
import type { DeadlinePayload } from "../../shared/types/tasks.ts";

interface CalendarSearchInputError extends Error {
  status: number;
  code: string;
}

interface DateRange {
  start: string;
  end: string;
}

interface CoverageSource {
  key: string;
  label: string;
  searched: boolean;
  start: string;
  end: string;
  strategy?: string;
  syncHealth?: unknown;
  errors?: Array<{ source?: string; message: string }>;
}

interface SearchHealth {
  state: string;
  configured?: boolean | null;
  severity?: string;
  sources?: Array<{ lastSuccessAt?: string | null }>;
}

type EventSearchInput = Parameters<typeof normalizeEventSearchCandidate>[0];
interface CalendarSearchDependencies {
  getCalendarSearchMirrorHealth: (userId: string) => Promise<SearchHealth>;
  listCalendarSearchMirrorOccurrences: (
    userId: string,
    options: DateRange & { query: string; limit: number; centerDate: string },
  ) => Promise<EventSearchInput[]>;
  now?: () => Date;
  readCalendarDeadlineRange: (
    userId: string,
    range: DateRange,
  ) => Promise<{ payload: DeadlinePayload; errors?: Array<{ source?: string; message: string }> }>;
  requestCalendarSearchMirrorSync: (
    userId: string,
    options: { reason: string; forceFull: boolean },
  ) => unknown;
}

const SEARCH_MIN_QUERY_LENGTH = 2;
const SEARCH_MIRROR_CANDIDATE_LIMIT = 1000;
const SEARCH_HISTORY_MONTHS = 12;
const SEARCH_FUTURE_MONTHS = 18;

function calendarSearchInputError(code: string, message: string): CalendarSearchInputError {
  const err = new Error(message) as CalendarSearchInputError;
  err.name = "CalendarSearchInputError";
  err.status = 400;
  err.code = code;
  return err;
}

export function isCalendarSearchInputError(err: unknown) {
  return (err as Error)?.name === "CalendarSearchInputError";
}

function cheapEmptyCalendarSearchResponse({
  query,
  scope,
  limit,
  fetchedAt,
}: { query: string; scope: string; limit: number; fetchedAt: string }) {
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

function pacificDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
}

function calendarSearchMirrorWindow({ now }: { now: Date }): DateRange {
  const today = pacificDate(now);
  return {
    start: addMonthsIso(today, -SEARCH_HISTORY_MONTHS),
    end: addMonthsIso(today, SEARCH_FUTURE_MONTHS),
  };
}

function calendarSearchResponse({
  query,
  scope,
  limit,
  candidates,
  coverageSources,
  now,
}: {
  query: string;
  scope: string;
  limit: number;
  candidates: CalendarSearchCandidate[];
  coverageSources: CoverageSource[];
  now: Date;
}) {
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

function shouldRequestCalendarSearchMirrorRepair(syncHealth: SearchHealth) {
  return ["initializing", "stale", "degraded", "dirty", "unavailable", "needs_sync"]
    .includes(syncHealth?.state);
}

function calendarSearchMirrorSearched(syncHealth: SearchHealth, events: EventSearchInput[]) {
  if (events?.length) return true;
  return !["initializing", "unavailable"].includes(syncHealth?.state);
}

export function createCalendarSearchService({
  getCalendarSearchMirrorHealth,
  listCalendarSearchMirrorOccurrences,
  now = () => new Date(),
  readCalendarDeadlineRange,
  requestCalendarSearchMirrorSync,
}: CalendarSearchDependencies) {
  return async function searchCalendar(
    userId: string,
    queryParams: { q?: unknown; scope?: unknown; limit?: unknown } = {},
  ) {
    const query = String(queryParams.q || "").trim();
    const scope = String(queryParams.scope || "events").trim();
    const limit = normalizeLimit(queryParams.limit);
    if (scope !== "events") {
      throw calendarSearchInputError(
        "calendar_search_scope_invalid",
        "scope must be events",
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
  };
}

let productionSearchCalendar: ReturnType<typeof createCalendarSearchService> | null = null;

async function loadProductionSearchCalendar() {
  if (productionSearchCalendar) return productionSearchCalendar;
  const [deadlines, mirror] = await Promise.all([
    import("../tasks/deadlines-read.ts"),
    import("./calendar-search-mirror.ts"),
  ]);
  productionSearchCalendar = createCalendarSearchService({
    getCalendarSearchMirrorHealth: mirror.getCalendarSearchMirrorHealth,
    listCalendarSearchMirrorOccurrences: mirror.listCalendarSearchMirrorOccurrences,
    readCalendarDeadlineRange: deadlines.readCalendarDeadlineRange,
    requestCalendarSearchMirrorSync: mirror.requestCalendarSearchMirrorSync,
  });
  return productionSearchCalendar;
}

export async function searchCalendar(...args: Parameters<ReturnType<typeof createCalendarSearchService>>) {
  const search = await loadProductionSearchCalendar();
  return search(...args);
}
