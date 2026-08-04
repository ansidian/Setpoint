import { describe, expect, it, vi } from "vitest";
import { createCalendarSearchService } from "./calendar-search-service.ts";

function dependencies(overrides = {}) {
  return {
    billMirrorRefreshRange: vi.fn(),
    getCalendarSearchMirrorHealth: vi.fn(),
    isBillsMirrorMaintenanceDue: vi.fn(),
    listCalendarSearchMirrorOccurrences: vi.fn(),
    readBillsMirrorRange: vi.fn(),
    readCalendarDeadlineRange: vi.fn(),
    requestBillsCurrentMaintenanceRefresh: vi.fn(),
    requestCalendarSearchMirrorSync: vi.fn(),
    scheduleBillsMirrorRefresh: vi.fn(),
    shouldScheduleImmediateBillsRefresh: vi.fn(),
    now: () => new Date("2026-05-12T19:00:00.000Z"),
    logger: { error: vi.fn() },
    ...overrides,
  };
}

describe("createCalendarSearchService", () => {
  it("rejects invalid scopes before starting search fanout", async () => {
    const deps = dependencies({
      listCalendarSearchMirrorOccurrences: vi.fn(() => { throw new Error("calendar mirror read should not start"); }),
      readBillsMirrorRange: vi.fn(() => { throw new Error("bills mirror read should not start"); }),
    });
    const search = createCalendarSearchService(deps);

    await expect(search("test-user", { scope: "all", q: "final" })).rejects.toMatchObject({
      status: 400,
      code: "calendar_search_scope_invalid",
      message: "scope must be events or bills",
    });
  });

  it("rejects invalid limits before starting search fanout", async () => {
    const deps = dependencies({
      listCalendarSearchMirrorOccurrences: vi.fn(() => { throw new Error("calendar mirror read should not start"); }),
    });
    const search = createCalendarSearchService(deps);

    await expect(search("test-user", { scope: "events", q: "final", limit: "0" }))
      .rejects.toMatchObject({
        status: 400,
        code: "calendar_search_limit_invalid",
        message: "limit must be a positive integer",
      });
  });

  it("returns the cheap empty envelope for short queries without fanout", async () => {
    const deps = dependencies({
      listCalendarSearchMirrorOccurrences: vi.fn(() => { throw new Error("calendar mirror read should not start"); }),
      readBillsMirrorRange: vi.fn(() => { throw new Error("bills mirror read should not start"); }),
    });
    const search = createCalendarSearchService(deps);

    await expect(search("test-user", { scope: "events", q: " f " })).resolves.toEqual({
      query: "f",
      scope: "events",
      limit: 50,
      results: [],
      resultCount: 0,
      totalMatches: 0,
      truncated: false,
      coverage: {
        scope: "events",
        reason: "query_too_short",
        sources: [],
      },
      fetchedAt: "2026-05-12T19:00:00.000Z",
    });
  });

  it("searches the event mirror and deadlines across the rolling mirror window", async () => {
    const syncHealth = {
      state: "stale",
      sources: [{ lastSuccessAt: "2026-05-11T19:00:00.000Z" }],
    };
    const deps = dependencies({
      listCalendarSearchMirrorOccurrences: vi.fn(async (userId: string, input: Record<string, unknown>) => (
        userId === "test-user"
          && input.start === "2025-05-12"
          && input.end === "2027-11-12"
          && input.query === "final"
          && input.limit === 1000
          && input.centerDate === "2026-05-12"
          ? [{
              id: "event-1",
              title: "Final presentation",
              startMs: Date.parse("2026-05-20T17:00:00.000Z"),
              endMs: Date.parse("2026-05-20T18:00:00.000Z"),
              source: "School",
              accountId: "gmail-main",
              calendarId: "primary",
            }]
          : []
      )),
      getCalendarSearchMirrorHealth: vi.fn().mockResolvedValue(syncHealth),
      readCalendarDeadlineRange: vi.fn(async (userId: string, range: Record<string, unknown>) => ({
        payload: {
          upcoming: userId === "test-user"
            && range.start === "2025-05-12"
            && range.end === "2027-11-12"
            ? [{ id: "deadline-1", title: "Final project upload", due_date: "2026-05-19" }]
            : [],
        },
        errors: [],
      })),
    });
    const search = createCalendarSearchService(deps);

    const response = await search("test-user", { scope: "events", q: "final", limit: "5" });

    // test-architecture: allow-boundary-interaction -- Stale-mirror repair is a background-process boundary; the response cannot establish its non-blocking wake-up reason.
    expect(deps.requestCalendarSearchMirrorSync).toHaveBeenCalledWith("test-user", {
      reason: "calendar-search-stale",
      forceFull: false,
    });
    expect(response).toMatchObject({
      query: "final",
      scope: "events",
      limit: 5,
      resultCount: 2,
      totalMatches: 2,
      truncated: false,
      coverage: {
        scope: "events",
        sources: [
          { key: "google_calendar", searched: true, syncHealth },
          { key: "deadlines", searched: true, errors: [] },
        ],
      },
      fetchedAt: "2026-05-12T19:00:00.000Z",
    });
    expect(response.results.map((result) => result.type)).toEqual(["deadline", "event"]);
  });

  it("searches the bills mirror and schedules an immediate refresh when needed", async () => {
    const syncHealth = { state: "needs_sync", configured: true };
    const deps = dependencies({
      billMirrorRefreshRange: vi.fn(({ now }: { now: Date }) => now.toISOString() === "2026-05-12T19:00:00.000Z"
        ? { start: "2026-04-12", end: "2027-11-12" }
        : { start: "invalid", end: "invalid" }),
      readBillsMirrorRange: vi.fn(async (userId: string, range: Record<string, unknown>) => ({
        schedules: userId === "test-user"
          && range.start === "2026-04-12"
          && range.end === "2027-11-12"
          ? [{
              id: "schedule-rent:2026-05-15",
              scheduleId: "schedule-rent",
              name: "Rent",
              amount: 1900,
              next_date: "2026-05-15",
            }]
          : [],
        actualBudgetUrl: "http://actual.local",
        syncHealth,
      })),
      shouldScheduleImmediateBillsRefresh: vi.fn().mockReturnValue(true),
      scheduleBillsMirrorRefresh: vi.fn().mockResolvedValue({ queued: true }),
    });
    const search = createCalendarSearchService(deps);

    const response = await search("test-user", { scope: "bills", q: "rent" });

    // test-architecture: allow-boundary-interaction -- Bills mirror refresh is a timer/process boundary; stale search coverage must enqueue the owner-specific refresh.
    expect(deps.scheduleBillsMirrorRefresh).toHaveBeenCalledWith("test-user");
    // test-architecture: allow-boundary-interaction -- Search-triggered mirror maintenance must not duplicate the separate current-dashboard maintenance worker.
    expect(deps.requestBillsCurrentMaintenanceRefresh).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      query: "rent",
      scope: "bills",
      limit: 50,
      resultCount: 1,
      totalMatches: 1,
      truncated: false,
      results: [{ type: "bill", title: "Rent", itemDate: "2026-05-15" }],
      coverage: {
        scope: "bills",
        sources: [{
          key: "bills_mirror",
          searched: true,
          syncHealth,
          actualBudgetUrl: "http://actual.local",
        }],
      },
      fetchedAt: "2026-05-12T19:00:00.000Z",
    });
  });
});
