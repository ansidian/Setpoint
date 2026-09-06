import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentDashboardCacheKey } from "../../shared/types/dashboard.ts";
import {
  setupCurrentServiceTest, cleanupCurrentServiceTest, testState, seedCache,
  requestCurrentDashboardRefresh, getDashboardSystemHealth,
  markCacheRowRefreshFailed, markRowsRefreshing,
} from "./current-service.test-utils.ts";

beforeEach(setupCurrentServiceTest);
afterEach(cleanupCurrentServiceTest);

const savedAt = "2026-05-04T10:00:00.000Z";
const now = new Date("2026-05-04T12:00:00.000Z");
const sources: CurrentDashboardCacheKey[] = ["weather_current", "calendar_current", "deadlines_current", "bills_current"];

async function seedSavedData() {
  const payloads = [{ temp: 61 }, [{ id: "saved-event" }], { upcoming: [], stats: null }, { bills: [], allSchedules: [], payeeMap: {}, actualConfigured: true }];
  for (const [index, key] of sources.entries()) {
    await seedCache(key, payloads[index], { fetchedAt: savedAt, expiresAt: savedAt });
  }
}

async function persistedRows() {
  return (await testState.db.current.execute("SELECT * FROM ea_current_data_cache ORDER BY cache_key")).rows;
}

describe("source-specific dashboard refresh", () => {
  it.each(sources)("refreshes only %s while other cached sources are also overdue", async (source) => {
    await seedSavedData();
    const before = await persistedRows();
    const result = await requestCurrentDashboardRefresh("u1", { dbClient: testState.db.current, now, source });
    const after = await persistedRows();
    expect(after.find((row) => row.cache_key === source)?.fetched_at).toBe(now.toISOString());
    expect(after.filter((row) => row.cache_key !== source)).toEqual(before.filter((row) => row.cache_key !== source));
    expect(result.refresh.scheduled).toEqual([]);
    // test-architecture: allow-boundary-interaction -- An explicit source retry must not initiate other outbound provider requests; unchanged cache rows alone cannot prove their absence.
    expect(testState.fetchWeather).toHaveBeenCalledTimes(source === "weather_current" ? 1 : 0);
    // test-architecture: allow-boundary-interaction -- Google Calendar requests are a separately billed/authenticated provider boundary; this source-scoping contract is the observable interaction.
    expect(testState.fetchCalendar).toHaveBeenCalledTimes(source === "calendar_current" ? 1 : 0);
    // test-architecture: allow-boundary-interaction -- Todoist task reads can trigger provider sync; only selecting Tasks authorizes that outbound work.
    expect(testState.fetchTodoistTasks).toHaveBeenCalledTimes(source === "deadlines_current" ? 1 : 0);
    // test-architecture: allow-boundary-interaction -- Actual metadata refresh crosses the filesystem/provider boundary and must only run for the selected Bills source.
    expect(testState.readLocalActualMetadata).toHaveBeenCalledTimes(source === "bills_current" ? 1 : 0);
  });

  it("does not bootstrap missing unrelated cache sources", async () => {
    await requestCurrentDashboardRefresh("u1", { dbClient: testState.db.current, now, source: "weather_current" });
    expect((await persistedRows()).map((row) => row.cache_key)).toEqual(["weather_current"]);
  });

  it("preserves saved data and old success time when the selected provider fails", async () => {
    await seedSavedData();
    vi.spyOn(console, "error").mockImplementation(() => {});
    testState.fetchWeather.mockRejectedValue(new Error("private upstream failure"));
    const result = await requestCurrentDashboardRefresh("u1", { dbClient: testState.db.current, now, source: "weather_current" });
    expect(result.weather).toMatchObject({ temp: 61 });
    expect(result.systemStatus.sources.find((source) => source.key === "weather")).toMatchObject({ state: "degraded", lastSuccessAt: savedAt, retrySource: "weather_current" });
    expect(JSON.stringify(result.systemStatus)).not.toContain("private upstream failure");
  });

  it("awaits an existing refresh for the same provider", async () => {
    let finish!: (value: unknown) => void;
    testState.fetchWeather.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = requestCurrentDashboardRefresh("u1", { dbClient: testState.db.current, source: "weather_current" });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const second = requestCurrentDashboardRefresh("u1", { dbClient: testState.db.current, source: "weather_current" });
    await new Promise((resolve) => setImmediate(resolve));
    finish({ temp: 81 });
    expect((await Promise.all([first, second])).map((result) => result.weather?.temp)).toEqual([81, 81]);
    // test-architecture: allow-boundary-interaction -- Two concurrent retries must join one outbound Weather request; identical returned data cannot establish that deduplication contract.
    expect(testState.fetchWeather).toHaveBeenCalledTimes(1);
  });
});

describe("cold failure freshness", () => {
  it("keeps unavailable fallbacks without a success timestamp through a retry transition", async () => {
    const failed = await markCacheRowRefreshFailed("u1", "calendar_current", new Error("calendar down"), { dbClient: testState.db.current, now });
    const initial = await getDashboardSystemHealth("u1", { dbClient: testState.db.current, now });
    expect(initial.systemStatus.sources.find((source) => source.key === "calendar")).toMatchObject({ state: "unavailable", lastSuccessAt: null });
    await markRowsRefreshing("u1", { calendar_current: failed }, ["calendar_current"], { dbClient: testState.db.current, now });
    const retrying = await getDashboardSystemHealth("u1", { dbClient: testState.db.current, now });
    expect(retrying.systemStatus.sources.find((source) => source.key === "calendar")).toMatchObject({ state: "unavailable", lastSuccessAt: null });
    expect((await persistedRows())[0]?.fetched_at).toBeNull();
  });
});
