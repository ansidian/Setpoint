import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupCurrentServiceTest, cleanupCurrentServiceTest,
  testState,
  EMPTY_DEADLINES_FOR_TEST,
  applyDeadlineCurrentStatus,
  getCurrentDashboard,
  getDashboardSystemHealth,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
  markRowsRefreshing,
  markCacheRowRefreshFailed,
  seedCache,
  getCurrentResponse,
  requestRefreshResponse,
  syncResponse
} from "./current-service.test-utils.ts";

beforeEach(setupCurrentServiceTest);
afterEach(cleanupCurrentServiceTest);

describe("applyDeadlineCurrentStatus", () => {
  it("does not complete the next recurring occurrence after the provider advances the shared task id", async () => {
    await seedCache("deadlines_current", {
      upcoming: [{ id: "recur-1", due_date: "2026-08-18", status: "incomplete" }],
      stats: { incomplete: 1, dueToday: 1, dueThisWeek: 1, totalPoints: 0 },
    });

    const result = await applyDeadlineCurrentStatus(
      "u1",
      "recur-1",
      "2026-08-15",
      "complete",
      { dbClient: testState.db.current, now: new Date("2026-08-16T16:20:09.000Z") },
    );

    expect(result).toEqual({ updated: false });
    const cache = await testState.db.current.execute({
      sql: "SELECT payload_json FROM ea_current_data_cache WHERE user_id = ? AND cache_key = 'deadlines_current'",
      args: ["u1"],
    });
    expect(JSON.parse(String(cache.rows[0]?.payload_json)).upcoming[0]).toMatchObject({
      id: "recur-1",
      due_date: "2026-08-18",
      status: "incomplete",
    });
  });
});

describe("GET /api/dashboard/current", () => {
  it.each([
    ["current", getCurrentDashboard],
    ["manual refresh", requestCurrentDashboardRefresh],
    ["force sync", syncCurrentDashboard],
    ["health", getDashboardSystemHealth],
  ] as const)("includes the same reconnection evidence in %s", async (_label, read) => {
    await testState.db.current.execute("UPDATE ea_accounts SET needs_reauth = 1 WHERE id = 'gmail-a'");
    await testState.db.current.execute("INSERT INTO ea_accounts (id, user_id, type, email, needs_reauth) VALUES ('icloud-a', 'u1', 'icloud', 'a@icloud.com', 1)");
    await testState.db.current.execute("UPDATE ea_settings SET todoist_needs_reauth = 1 WHERE user_id = 'u1'");
    const response = await read("u1", { dbClient: testState.db.current });
    expect(response.systemStatus.state).toBe("unavailable");
    expect(response.systemStatus.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "reauth:gmail-a", state: "needs_reauth", action: { label: "Reconnect Google", href: "/settings?tab=connections#google-workspace" } }),
      expect.objectContaining({ key: "reauth:icloud-a", label: "iCloud Mail (a@icloud.com)", state: "needs_reauth" }),
      expect.objectContaining({ key: "todoist", state: "needs_reauth" }),
    ]));
  });

  it.each([getCurrentDashboard, getDashboardSystemHealth])("reads authoritative Bills failure instead of an older healthy cached payload", async (read) => {
    await seedCache("weather_current", { temp: 64 });
    await seedCache("calendar_current", []);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", { bills: [], allSchedules: [], payeeMap: {}, actualConfigured: true, billsSyncHealth: { state: "current", configured: true, lastSuccessAt: "2026-09-06T10:00:00.000Z" } });
    await testState.db.current.execute({
      sql: "INSERT INTO ea_bills_mirror_state (user_id, status, actual_configured, last_success_at, last_attempt_at, last_error) VALUES ('u1', 'degraded', 1, '2026-09-05T10:00:00.000Z', ?, 'sensitive upstream failure')",
      args: [new Date().toISOString()],
    });
    const response = await read("u1", { dbClient: testState.db.current });
    expect(response.systemStatus.sources.find((source) => source.key === "bills")).toMatchObject({ state: "degraded", severity: "warning", lastSuccessAt: "2026-09-05T10:00:00.000Z" });
    expect(JSON.stringify(response.systemStatus)).not.toContain("sensitive upstream failure");
  });

  it("does not report Bills current when its authoritative health read fails", async () => {
    await seedCache("bills_current", { bills: [], allSchedules: [], payeeMap: {}, actualConfigured: true, billsSyncHealth: { state: "current", configured: true } });
    await testState.db.current.execute("DROP TABLE ea_bills_mirror_state");
    const response = await getDashboardSystemHealth("u1", { dbClient: testState.db.current });
    expect(response.systemStatus.sources.find((source) => source.key === "bills")).toMatchObject({ state: "unavailable", severity: "error" });
  });

  it("starts a background current refresh and returns cached rows without waiting for providers", async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await seedCache("weather_current", { temp: 64, location: "El Monte, CA" }, { expiresAt: expiredAt });
    await seedCache("calendar_current", [{ id: "cached-event" }], { expiresAt: expiredAt });
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST, { expiresAt: expiredAt });
    await seedCache("bills_current", {
      bills: [{ id: "cached-bill" }],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    }, { expiresAt: expiredAt });
    const pending = new Promise(() => {});
    testState.fetchWeather.mockReturnValueOnce(pending);
    testState.fetchCalendar.mockReturnValueOnce(pending);
    testState.fetchTodoistTasks.mockReturnValueOnce(pending);

    const res = await requestRefreshResponse();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 64, location: "El Monte, CA" },
      calendar: [{ id: "cached-event" }],
      bills: [{ id: "cached-bill" }],
      activeSnapshot: { snapshot: { id: 42 } },
      providerHealth: {
        currentData: {
          state: "current",
          sources: expect.arrayContaining([
            expect.objectContaining({ key: "weather_current", state: "refreshing" }),
            expect.objectContaining({ key: "calendar_current", state: "refreshing" }),
            expect.objectContaining({ key: "deadlines_current", state: "refreshing" }),
            expect.objectContaining({ key: "bills_current", state: "refreshing" }),
          ]),
        },
        activeSnapshot: { state: "syncing", reason: "background" },
      },
      systemStatus: {
        state: "needs_sync",
      },
      refresh: {
        mode: "manual",
        scheduled: expect.arrayContaining([
          expect.objectContaining({ key: "weather_current", reason: "ttl_due" }),
          expect.objectContaining({ key: "bills_current", reason: "ttl_due" }),
          expect.objectContaining({ key: "active_snapshot", reason: "manual_retry" }),
        ]),
      },
    });
  });

  it("degrades one failed provider without failing the current response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    testState.fetchWeather.mockRejectedValueOnce(new Error("weather down"));
    testState.fetchCalendar.mockResolvedValueOnce([{ id: "event-ok" }]);
    testState.fetchTodoistTasks.mockResolvedValueOnce([]);

    const res = await getCurrentResponse();

    expect(res.status).toBe(200);
    expect(res.body.weather).toBeNull();
    expect(res.body.calendar).toEqual([
      expect.objectContaining({
        id: "event-ok",
        hasUpcomingReminder: false,
        upcomingReminderCount: 0,
        nextReminderAt: null,
      }),
    ]);
    expect(res.body.providerHealth.currentData.state).toBe("unavailable");
    expect(res.body.providerHealth.currentData.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "weather_current",
          state: "unavailable",
          errorMessage: "weather down",
        }),
        expect.objectContaining({
          key: "calendar_current",
          state: "current",
        }),
      ]),
    );
  });

  it("returns a fallback within the deadline instead of hanging when a cold-cache provider stalls (P1-6)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.EA_DASHBOARD_PROVIDER_FETCH_TIMEOUT_MS = "20";
    // Cold cache (no seedCache) + a weather provider fetch that never resolves.
    testState.fetchWeather.mockReset().mockReturnValueOnce(new Promise(() => {}));

    const { status, body } = await getCurrentResponse();

    expect(status).toBe(200);
    // The stalled provider must fall back (the aggregated current-data source
    // goes unavailable) rather than blocking the entire /current response on the
    // slowest external call.
    expect(body.systemStatus.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "weather",
          state: expect.stringMatching(/unavailable|degraded/),
        }),
      ]),
    );
  }, 3000);
});

describe("POST /api/dashboard/current/sync", () => {
  beforeEach(() => {
    testState.fetchWeather.mockResolvedValue({ temp: 80, summary: "Synced" });
    testState.fetchCalendar.mockResolvedValue([{ id: "synced-event" }]);
    testState.getActiveSnapshotView.mockResolvedValue({ snapshot: { id: 41 } });
    testState.syncActiveSnapshot.mockResolvedValue({ snapshot: { id: 99 } });
  });

  it("force refreshes current rows and the active snapshot", async () => {
    await seedCache("weather_current", { temp: 60, location: "Old" });
    await seedCache("calendar_current", [{ id: "old-event" }]);
    await seedCache("deadlines_current", EMPTY_DEADLINES_FOR_TEST);
    await seedCache("bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: true,
      actualBudgetUrl: "https://actual.example.test",
    });

    const res = await syncResponse();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 80, summary: "Synced", location: "El Monte, CA" },
      calendar: [{ id: "synced-event" }],
      bills: [expect.objectContaining({ scheduleId: "synced-bill", name: "Synced Bill" })],
      activeSnapshot: { snapshot: { id: 99 } },
      providerHealth: {
        currentData: { state: "current" },
      },
    });
    const mirrorState = await testState.db.current.execute({
      sql: `SELECT status, actual_configured, actual_budget_url, last_success_at, last_error
            FROM ea_bills_mirror_state WHERE user_id = 'u1'`,
    });
    expect(mirrorState.rows[0]).toMatchObject({
      status: "current",
      actual_configured: 1,
      actual_budget_url: "https://actual.example.test",
      last_error: null,
    });
    expect(mirrorState.rows[0]?.last_success_at).toBe("2026-05-04T12:00:00.000Z");
  });
});

describe("markRowsRefreshing -> markCacheRowRefreshFailed failureCount carry (P3-42)", () => {
  it("escalates the returned failureCount instead of resetting to 1 across the refreshing transition", async () => {
    const failedAt = "2026-05-04T11:40:00.000Z";
    // Prior degraded row that has already failed twice.
    await testState.db.current.execute({
      sql: `INSERT INTO ea_current_data_cache
              (user_id, cache_key, payload_json, fetched_at, expires_at, status,
               last_refresh_failed_at, last_refresh_error, refresh_failure_count, updated_at)
            VALUES (?, 'weather_current', ?, ?, ?, 'degraded', ?, ?, 2, ?)`,
      args: [
        "u1",
        JSON.stringify({ temp: 64, location: "El Monte, CA" }),
        failedAt,
        "2026-05-04T12:40:00.000Z",
        failedAt,
        "weather down",
        failedAt,
      ],
    });

    const loaded = await testState.db.current.execute({
      sql: `SELECT user_id, cache_key, payload_json, fetched_at, expires_at, status, error_message,
                   refresh_started_at, last_refresh_failed_at, last_refresh_error, refresh_failure_count
            FROM ea_current_data_cache WHERE user_id = 'u1' AND cache_key = 'weather_current'`,
    });
    const rows = { weather_current: loaded.rows[0] };

    const now = new Date("2026-05-04T12:00:00.000Z");
    // Transition the row to "refreshing" (this is what the hot path hands to the
    // background refresh as existingRow).
    const refreshingRows = await markRowsRefreshing("u1", rows, ["weather_current"], {
      dbClient: testState.db.current,
      now,
    });

    // The in-memory refreshing row must still carry the prior failure count, so a
    // subsequent failure escalates rather than resetting to 1.
    const failed = await markCacheRowRefreshFailed("u1", "weather_current", new Error("weather down again"), {
      dbClient: testState.db.current,
      now,
      existingRow: refreshingRows.weather_current,
    });

    expect(failed.refresh_failure_count).toBe(3);

    // Persistence must agree with the returned object.
    const persisted = await testState.db.current.execute({
      sql: `SELECT refresh_failure_count FROM ea_current_data_cache
            WHERE user_id = 'u1' AND cache_key = 'weather_current'`,
    });
    expect(Number(persisted.rows[0]!.refresh_failure_count)).toBe(3);
  });
});
