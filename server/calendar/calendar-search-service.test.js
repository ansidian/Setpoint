import { describe, expect, it, vi } from "vitest";
import { createCalendarSearchService } from "./calendar-search-service.js";

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
    const deps = dependencies();
    const search = createCalendarSearchService(deps);

    await expect(search("test-user", { scope: "all", q: "final" })).rejects.toMatchObject({
      status: 400,
      code: "calendar_search_scope_invalid",
      message: "scope must be events or bills",
    });
    expect(deps.listCalendarSearchMirrorOccurrences).not.toHaveBeenCalled();
    expect(deps.readBillsMirrorRange).not.toHaveBeenCalled();
  });

  it("rejects invalid limits before starting search fanout", async () => {
    const deps = dependencies();
    const search = createCalendarSearchService(deps);

    await expect(search("test-user", { scope: "events", q: "final", limit: "0" }))
      .rejects.toMatchObject({
        status: 400,
        code: "calendar_search_limit_invalid",
        message: "limit must be a positive integer",
      });
    expect(deps.listCalendarSearchMirrorOccurrences).not.toHaveBeenCalled();
  });

  it("returns the cheap empty envelope for short queries without fanout", async () => {
    const deps = dependencies();
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
    expect(deps.listCalendarSearchMirrorOccurrences).not.toHaveBeenCalled();
    expect(deps.readBillsMirrorRange).not.toHaveBeenCalled();
  });

  it("searches the event mirror and deadlines across the rolling mirror window", async () => {
    const syncHealth = {
      state: "stale",
      sources: [{ lastSuccessAt: "2026-05-11T19:00:00.000Z" }],
    };
    const deps = dependencies({
      listCalendarSearchMirrorOccurrences: vi.fn().mockResolvedValue([{
        id: "event-1",
        title: "Final presentation",
        startMs: Date.parse("2026-05-20T17:00:00.000Z"),
        endMs: Date.parse("2026-05-20T18:00:00.000Z"),
        source: "School",
        accountId: "gmail-main",
        calendarId: "primary",
      }]),
      getCalendarSearchMirrorHealth: vi.fn().mockResolvedValue(syncHealth),
      readCalendarDeadlineRange: vi.fn().mockResolvedValue({
        payload: {
          upcoming: [{
            id: "deadline-1",
            title: "Final project upload",
            due_date: "2026-05-19",
          }],
        },
        errors: [],
      }),
    });
    const search = createCalendarSearchService(deps);

    const response = await search("test-user", { scope: "events", q: "final", limit: "5" });

    expect(deps.listCalendarSearchMirrorOccurrences).toHaveBeenCalledWith("test-user", {
      start: "2025-05-12",
      end: "2027-11-12",
      query: "final",
      limit: 1000,
      centerDate: "2026-05-12",
    });
    expect(deps.readCalendarDeadlineRange).toHaveBeenCalledWith("test-user", {
      start: "2025-05-12",
      end: "2027-11-12",
    });
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
      billMirrorRefreshRange: vi.fn().mockReturnValue({
        start: "2026-04-12",
        end: "2027-11-12",
      }),
      readBillsMirrorRange: vi.fn().mockResolvedValue({
        schedules: [{
          id: "schedule-rent:2026-05-15",
          scheduleId: "schedule-rent",
          name: "Rent",
          amount: 1900,
          next_date: "2026-05-15",
        }],
        actualBudgetUrl: "http://actual.local",
        syncHealth,
      }),
      shouldScheduleImmediateBillsRefresh: vi.fn().mockReturnValue(true),
      scheduleBillsMirrorRefresh: vi.fn().mockResolvedValue({ queued: true }),
    });
    const search = createCalendarSearchService(deps);

    const response = await search("test-user", { scope: "bills", q: "rent" });

    expect(deps.billMirrorRefreshRange).toHaveBeenCalledWith({
      now: new Date("2026-05-12T19:00:00.000Z"),
    });
    expect(deps.readBillsMirrorRange).toHaveBeenCalledWith("test-user", {
      start: "2026-04-12",
      end: "2027-11-12",
    });
    expect(deps.scheduleBillsMirrorRefresh).toHaveBeenCalledWith("test-user");
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
