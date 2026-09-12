import { describe, expect, it } from "vitest";
import type { CurrentDashboardSourceHealth } from "../../shared/types/dashboard.ts";
import { composeSystemStatus } from "./currentSystemStatusModel.ts";

describe("composeSystemStatus", () => {
  it("rolls a stale todoist mirror into needs_sync", () => {
    const out = composeSystemStatus({
      currentData: { state: "current", lastSuccessAt: null },
      todoist: { state: "stale", severity: "warning" },
      bills: { state: "current" },
    }, { generatedAt: "2026-06-21T00:00:00.000Z" });
    const todoist = out.sources.find((s) => s.key === "todoist");
    expect(todoist!.state).toBe("needs_sync");
    expect(out.generatedAt).toBe("2026-06-21T00:00:00.000Z");
  });

  it("derives a bills warning severity for needs_sync/degraded/stale", () => {
    const out = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "needs_sync" },
    });
    const bills = out.sources.find((s) => s.key === "bills");
    expect(bills!.severity).toBe("warning");
  });

  it("summarizes unavailable when any source is in error, needs_sync when a warning source needs sync", () => {
    const errorOut = composeSystemStatus({
      currentData: { state: "unavailable" },
      todoist: { state: "current" },
      bills: { state: "current" },
    });
    expect(errorOut.state).toBe("unavailable");

    const needsSyncOut = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "needs_sync", severity: "warning" },
      bills: { state: "current" },
    });
    expect(needsSyncOut.state).toBe("needs_sync");
  });

  it("appends a loud reauth source per flagged Gmail account plus Todoist, driving overall state unavailable", () => {
    const out = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "current" },
      reauth: {
        accounts: [{ id: "gmail-x", email: "a@b.c" }],
        todoist: true,
      },
    });

    expect(out.sources).toHaveLength(4);
    const accountSource = out.sources.find((s) => s.key === "reauth:gmail-x");
    expect(accountSource).toMatchObject({
      label: "Google (a@b.c)",
      state: "needs_reauth",
      severity: "error",
      lastSuccessAt: null,
      message: "Reconnect this Google account to resume email and calendar updates.",
    });
    const todoistReauthSource = out.sources.find((s) => s.key === "todoist");
    expect(todoistReauthSource).toMatchObject({
      state: "needs_reauth",
      severity: "error",
    });
    expect(out.state).toBe("unavailable");
  });

  it("adds no reauth sources when providerHealth.reauth is absent or empty", () => {
    const out = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "current" },
    });
    expect(out.sources).toHaveLength(3);
    expect(out.sources.some((s) => s.key.startsWith("reauth:"))).toBe(false);

    const outEmpty = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "current" },
      reauth: { accounts: [], todoist: false },
    });
    expect(outEmpty.sources).toHaveLength(3);
  });
});


describe("domain status evidence", () => {
  const fetchedAt = "2026-09-06T12:00:00.000Z";
  const expiresAt = "2026-09-06T12:05:00.000Z";
  const cacheSource = (key: CurrentDashboardSourceHealth["key"], state: CurrentDashboardSourceHealth["state"] = "current"): CurrentDashboardSourceHealth => ({
    key, state, severity: state === "unavailable" ? "error" : state === "degraded" ? "warning" : state === "current" ? "none" : "info",
    fetchedAt, expiresAt, errorMessage: "secret provider error", failedAt: null, failureCount: 0, refreshStartedAt: null,
  });
  const baseline = () => ({
    currentData: { state: "current" as const, sources: [cacheSource("weather_current"), cacheSource("calendar_current"), cacheSource("deadlines_current"), cacheSource("bills_current")] },
    todoist: { state: "current" as const, lastSuccessAt: fetchedAt },
    bills: { state: "current", lastSuccessAt: fetchedAt },
  });

  it("reports due updates without an error and preserves each source's timestamps", () => {
    const input = baseline();
    input.currentData.sources[0] = cacheSource("weather_current", "needs_sync");
    const result = composeSystemStatus(input);
    expect(result.state).toBe("needs_sync");
    expect(result.sources).toHaveLength(4);
    expect(result.sources[0]).toMatchObject({ key: "weather", state: "needs_sync", severity: "info", lastSuccessAt: fetchedAt, expiresAt });
    expect(JSON.stringify(result)).not.toContain("secret provider error");
  });

  it("retains failed cache evidence when the task mirror is current", () => {
    const input = baseline();
    input.currentData.sources[2] = cacheSource("deadlines_current", "degraded");
    const result = composeSystemStatus(input);
    expect(result.state).toBe("degraded");
    expect(result.sources.find((source) => source.key === "todoist")).toMatchObject({ state: "degraded", severity: "warning" });
  });

  it("uses authoritative mirror failure and success time despite a freshly cached Bills payload", () => {
    const input = baseline();
    input.bills = { state: "unavailable", lastSuccessAt: "2026-09-05T12:00:00.000Z" };
    const result = composeSystemStatus(input);
    expect(result.state).toBe("unavailable");
    expect(result.sources.find((source) => source.key === "bills")).toMatchObject({
      state: "unavailable", lastSuccessAt: "2026-09-05T12:00:00.000Z", action: { href: "/settings?tab=connections#actual-budget" },
    });
  });

  it("does not advance displayed freshness past a failed dashboard cache when the mirror recovers", () => {
    const input = baseline();
    input.currentData.sources[3] = cacheSource("bills_current", "degraded");
    input.bills = { state: "current", lastSuccessAt: "2026-09-06T13:00:00.000Z" };
    const result = composeSystemStatus(input);
    expect(result.sources.find((source) => source.key === "bills")).toMatchObject({ state: "degraded", lastSuccessAt: fetchedAt });
  });

  it("retains failed Todoist checks even when the normal mirror grace period calls it current", () => {
    const input = baseline();
    const result = composeSystemStatus({ ...input, todoist: { ...input.todoist, severity: "none", failedCheckCount: 1, lastCheckFailedAt: "2026-09-06T12:04:00.000Z" } });
    expect(result.sources.find((source) => source.key === "todoist")).toMatchObject({ state: "degraded", severity: "warning", retrySource: "deadlines_current", lastSuccessAt: fetchedAt });
  });

  it("exposes retry targets for configured sources and only bounded active refresh evidence", () => {
    const input = baseline();
    const sources = input.currentData.sources.map((source, index) => ({ ...source, refreshStartedAt: index === 0 ? "2026-09-06T12:04:00.000Z" : "2026-09-06T12:00:00.000Z" }));
    const result = composeSystemStatus({ ...input, currentData: { ...input.currentData, sources } }, { generatedAt: "2026-09-06T12:05:00.000Z" });
    expect(result.sources.map((source) => source.retrySource)).toEqual(["weather_current", "calendar_current", "deadlines_current", "bills_current"]);
    expect(result.sources.map((source) => source.refreshStartedAt)).toEqual(["2026-09-06T12:04:00.000Z", null, null, null]);
    const disconnected = composeSystemStatus({ ...input, configured: { weather: false }, reauth: { accounts: [], todoist: true } });
    expect(disconnected.sources.find((source) => source.key === "weather")?.retrySource).toBeUndefined();
    expect(disconnected.sources.find((source) => source.key === "todoist")?.retrySource).toBeUndefined();
  });

  it("keeps intentionally disconnected sources neutral and reports healthy work in progress", () => {
    const input = baseline();
    input.currentData.sources[0] = cacheSource("weather_current", "degraded");
    input.currentData.sources[1] = cacheSource("calendar_current", "refreshing");
    const result = composeSystemStatus({ ...input, configured: { weather: false } }, { generatedAt: "2026-09-06T12:05:00.000Z" });
    expect(result.state).toBe("syncing");
    expect(result.sources[0]).toMatchObject({ state: "unconfigured", severity: "none", expiresAt: null });
  });

  it.each([
    ["2026-09-06T12:05:00.000Z", "current"],
    ["2026-09-06T12:19:59.999Z", "current"],
    ["2026-09-06T12:20:00.000Z", "needs_sync"],
  ])("bounds calendar freshness by the last complete check at %s", (generatedAt, state) => {
    const input = baseline();
    input.currentData.sources[1] = cacheSource("calendar_current", "needs_sync");
    const result = composeSystemStatus(input, { generatedAt });
    expect(result.sources.find((source) => source.key === "calendar")).toMatchObject({
      state, lastSuccessAt: fetchedAt, expiresAt: "2026-09-06T12:20:00.000Z",
    });
    expect(input.currentData.sources[1]?.expiresAt).toBe(expiresAt);
  });

  it("shows overdue calendar checks during a refresh and preserves failed checks within the grace period", () => {
    const input = baseline();
    input.currentData.sources[1] = cacheSource("calendar_current", "refreshing");
    const overdue = composeSystemStatus(input, { generatedAt: "2026-09-06T12:20:00.000Z" });
    expect(overdue.sources.find((source) => source.key === "calendar")).toMatchObject({ state: "needs_sync", severity: "info" });
    input.currentData.sources[1] = cacheSource("calendar_current", "degraded");
    const failed = composeSystemStatus(input, { generatedAt: "2026-09-06T12:06:00.000Z" });
    expect(failed.sources.find((source) => source.key === "calendar")).toMatchObject({ state: "degraded", severity: "warning" });
  });

  it("reports failed calendar push delivery without treating a working watch as a fresh provider check", () => {
    const input = baseline();
    const degraded = composeSystemStatus({ ...input, calendarPush: { state: "degraded", message: "Calendar updates are delayed. Automatic checks continue." } }, { generatedAt: "2026-09-06T12:06:00.000Z" });
    expect(degraded.sources.find((source) => source.key === "calendar")).toMatchObject({
      state: "degraded", severity: "warning", message: "Calendar updates are delayed. Automatic checks continue.",
    });
    const overdue = composeSystemStatus({ ...input, calendarPush: { state: "current" } }, { generatedAt: "2026-09-06T12:21:00.000Z" });
    expect(overdue.sources.find((source) => source.key === "calendar")).toMatchObject({
      state: "needs_sync", lastSuccessAt: fetchedAt, expiresAt: "2026-09-06T12:20:00.000Z",
    });
    const disconnected = composeSystemStatus({ ...input, configured: { calendar: false }, calendarPush: { state: "degraded" } });
    expect(disconnected.sources.find((source) => source.key === "calendar")).toMatchObject({ state: "unconfigured", severity: "none", expiresAt: null });
    input.currentData.sources[1] = { ...cacheSource("calendar_current", "unavailable"), fetchedAt: null };
    const unavailable = composeSystemStatus({ ...input, calendarPush: { state: "degraded" } });
    expect(unavailable.sources.find((source) => source.key === "calendar")).toMatchObject({ state: "unavailable", severity: "error", lastSuccessAt: null });
  });

  it("identifies iCloud reconnection and folds Todoist reauth into its existing task source", () => {
    const result = composeSystemStatus({ ...baseline(), reauth: { accounts: [{ id: "icloud-a", type: "icloud", email: "a@icloud.com" }], todoist: true } });
    expect(result.sources).toHaveLength(5);
    expect(result.sources.find((source) => source.key === "todoist")).toMatchObject({ state: "needs_reauth", action: { href: "/settings?tab=connections#todoist" } });
    expect(result.sources.find((source) => source.key === "reauth:icloud-a")).toMatchObject({ label: "iCloud Mail (a@icloud.com)", action: { href: "/settings?tab=connections#icloud-mail" } });
  });
});
