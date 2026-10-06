import { describe, expect, it } from "vitest";
import { CURRENT_DATA_PROVIDERS } from "./current-providers/index.ts";
import {
  applyProviderManualRefresh,
  planCurrentDataRefresh,
} from "./currentRefreshPlanModel.ts";
import type {
  CurrentDashboardCacheKey,
  CurrentDashboardCacheRow,
  CurrentDashboardCacheRows,
} from "../../shared/types/dashboard.ts";
import type { TodoistMirrorHealth } from "../../shared/types/tasks.ts";

const now = new Date("2026-06-21T00:00:00.000Z");

const usablePayloads: Record<CurrentDashboardCacheKey, unknown> = {
  weather_current: { temp: 71 },
  calendar_current: [],
  deadlines_current: { upcoming: [], stats: null },
};

function cacheRow(
  key: CurrentDashboardCacheKey,
  overrides: Partial<CurrentDashboardCacheRow> = {},
): CurrentDashboardCacheRow {
  return {
    status: "current",
    payload_json: JSON.stringify(usablePayloads[key]),
    fetched_at: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
    ...overrides,
  };
}

function freshRows(): CurrentDashboardCacheRows {
  return Object.fromEntries(
    CURRENT_DATA_PROVIDERS.map((provider) => [provider.key, cacheRow(provider.key)]),
  );
}

function todoistHealth(overrides: Partial<TodoistMirrorHealth>): TodoistMirrorHealth {
  return {
    state: "current",
    configured: true,
    lastSuccessAt: null,
    lastError: null,
    syncStartedAt: null,
    ageMs: null,
    ...overrides,
  };
}

describe("planCurrentDataRefresh", () => {
  it("force schedules every provider with reason 'force' and skips nothing", () => {
    const plan = planCurrentDataRefresh({}, { mode: "force", now, force: true });
    expect(plan.skipped).toEqual([]);
    expect(plan.scheduled.map((entry) => entry.key).sort()).toEqual(
      CURRENT_DATA_PROVIDERS.map((provider) => provider.key).sort(),
    );
    expect(plan.scheduled.every((entry) => entry.reason === "force")).toBe(true);
  });

  it("classifies missing, unusable, degraded, expired, and fresh rows", () => {
    const missing = freshRows();
    delete missing.weather_current;
    expect(planCurrentDataRefresh(missing, { mode: "passive", now }).scheduled).toContainEqual({
      key: "weather_current",
      reason: "missing",
    });

    const unusable = freshRows();
    unusable.weather_current = cacheRow("weather_current", { payload_json: "null" });
    expect(planCurrentDataRefresh(unusable, { mode: "passive", now }).scheduled).toContainEqual({
      key: "weather_current",
      reason: "no_usable_payload",
    });

    const degraded = freshRows();
    degraded.weather_current = cacheRow("weather_current", { status: "degraded" });
    expect(planCurrentDataRefresh(degraded, { mode: "passive", now }).scheduled).toContainEqual({
      key: "weather_current",
      reason: "degraded",
    });
    expect(planCurrentDataRefresh(degraded, { mode: "manual", now }).scheduled).toContainEqual({
      key: "weather_current",
      reason: "manual_retry",
    });

    const expired = freshRows();
    expired.weather_current = cacheRow("weather_current", {
      expires_at: new Date(now.getTime() - 1).toISOString(),
    });
    expect(planCurrentDataRefresh(expired, { mode: "passive", now }).scheduled).toContainEqual({
      key: "weather_current",
      reason: "ttl_due",
    });

    expect(planCurrentDataRefresh(freshRows(), { mode: "passive", now }).skipped).toContainEqual({
      key: "weather_current",
      reason: "fresh",
    });
  });

  it("distinguishes active and timed-out refreshing rows", () => {
    const active = freshRows();
    active.weather_current = cacheRow("weather_current", {
      status: "refreshing",
      refresh_started_at: now.toISOString(),
    });
    expect(planCurrentDataRefresh(active, { mode: "passive", now }).skipped).toContainEqual({
      key: "weather_current",
      reason: "already_refreshing",
    });

    const timedOut = freshRows();
    timedOut.weather_current = cacheRow("weather_current", {
      status: "refreshing",
      refresh_started_at: new Date(now.getTime() - 2 * 60_000 - 1).toISOString(),
    });
    expect(planCurrentDataRefresh(timedOut, { mode: "passive", now }).scheduled).toContainEqual({
      key: "weather_current",
      reason: "degraded",
    });
  });

  it("applies the passive failure-count backoff tiers", () => {
    for (const [failureCount, backoffMs] of [[1, 2 * 60_000], [2, 5 * 60_000], [3, 15 * 60_000]] as const) {
      const rows = freshRows();
      rows.weather_current = cacheRow("weather_current", {
        status: "degraded",
        refresh_failure_count: failureCount,
        last_refresh_failed_at: new Date(now.getTime() - backoffMs + 1).toISOString(),
      });
      expect(planCurrentDataRefresh(rows, { mode: "passive", now }).skipped).toContainEqual({
        key: "weather_current",
        reason: "backoff",
      });

      rows.weather_current.last_refresh_failed_at = new Date(now.getTime() - backoffMs).toISOString();
      expect(planCurrentDataRefresh(rows, { mode: "passive", now }).scheduled).toContainEqual({
        key: "weather_current",
        reason: "degraded",
      });
    }
  });

  it("refreshes fresh deadlines when Todoist needs sync or is newer than the cache", () => {
    const rows = freshRows();
    rows.deadlines_current = cacheRow("deadlines_current", {
      fetched_at: new Date(now.getTime() - 10 * 60_000).toISOString(),
    });

    for (const health of [
      todoistHealth({ state: "needs_sync" }),
      todoistHealth({ lastSuccessAt: new Date(now.getTime() - 5 * 60_000).toISOString() }),
    ]) {
      expect(planCurrentDataRefresh(rows, {
        mode: "passive",
        now,
        context: { todoistHealth: health },
      }).scheduled).toContainEqual({ key: "deadlines_current", reason: "needs_sync" });
    }
  });
});

describe("provider refresh-plan modifiers", () => {
  it("forces manual Todoist reconciliation while leaving stable providers skipped", () => {
    const rows = freshRows();
    const plan = planCurrentDataRefresh(rows, { mode: "manual", now });
    const forceKeys = new Set<CurrentDashboardCacheKey>();

    applyProviderManualRefresh(plan, rows, { forceKeys, now, context: {} });

    expect(plan.scheduled).toEqual(expect.arrayContaining([
      { key: "deadlines_current", reason: "manual_todoist_sync" },
    ]));
    expect(plan.skipped).toEqual(expect.arrayContaining([
      { key: "weather_current", reason: "fresh" },
      { key: "calendar_current", reason: "fresh" },
    ]));
    expect(forceKeys).toEqual(new Set(["deadlines_current"]));
  });
});
