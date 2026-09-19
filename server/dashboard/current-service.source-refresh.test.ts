import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentDashboardCacheKey } from "../../shared/types/dashboard.ts";
import {
  setupCurrentServiceTest, cleanupCurrentServiceTest, testState, seedCache,
  requestCurrentDashboardRefresh, getDashboardSystemHealth,
  markCacheRowRefreshFailed, markRowsRefreshing,
} from "./current-service.test-utils.ts";

beforeEach(setupCurrentServiceTest);
afterEach(() => { vi.useRealTimers(); cleanupCurrentServiceTest(); });

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
    expect(testState.syncActualMetadata).toHaveBeenCalledTimes(source === "bills_current" ? 1 : 0);
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

  it("persists the provider's original success time when Weather returns a cache hit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const providerFetchedAt = "2026-05-04T11:45:00.000Z";
    testState.fetchWeather.mockResolvedValue({ temp: 72, providerFetchedAt });
    const result = await requestCurrentDashboardRefresh("u1", { dbClient: testState.db.current, now, source: "weather_current" });
    expect(result.systemStatus.sources.find((source) => source.key === "weather")).toMatchObject({
      state: "current", lastSuccessAt: providerFetchedAt, expiresAt: "2026-05-04T12:45:00.000Z",
    });
    expect((await persistedRows())[0]?.fetched_at).toBe(providerFetchedAt);
    const later = await getDashboardSystemHealth("u1", { dbClient: testState.db.current, now: new Date("2026-05-04T12:45:00.000Z") });
    expect(later.systemStatus.sources.find((source) => source.key === "weather")?.state).toBe("needs_sync");
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


describe("email health in the dashboard envelope", () => {
  it("includes persisted per-account freshness and expires it without another provider request", async () => {
    await testState.db.current.execute({
      sql: "UPDATE ea_email_sync_health SET last_success_at = ? WHERE user_id = 'u1' AND account_id = 'gmail-a'",
      args: [now.toISOString()],
    });
    const read = (at: string) => getDashboardSystemHealth("u1", { dbClient: testState.db.current, now: new Date(at) });
    const fresh = await read("2026-05-04T12:19:59.999Z");
    expect(fresh.systemStatus.sources.find((source) => source.key === "email:gmail-a")).toMatchObject({
      state: "current", lastSuccessAt: now.toISOString(), expiresAt: "2026-05-04T12:20:00.000Z",
    });
    const overdue = await read("2026-05-04T12:20:00.000Z");
    expect(overdue.systemStatus.sources.find((source) => source.key === "email:gmail-a")?.state).toBe("needs_sync");
    await testState.db.current.execute("DROP TABLE ea_email_sync_health");
    const unknown = await read("2026-05-04T12:01:00.000Z");
    expect(unknown.systemStatus.sources.find((source) => source.key === "email")).toMatchObject({ state: "unavailable", lastSuccessAt: null });
  });
});
