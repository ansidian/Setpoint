import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import request, { fetchApp } from "../test-utils/supertest.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { seedOwner, seedSession } from "../test-utils/auth-db.ts";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

// test-architecture: allow-boundary-mock -- injects an ephemeral database while the real dashboard service composes cache, snapshot, and provider health state.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => currentDb().execute(statement),
    executeMultiple: (sql: string) => currentDb().executeMultiple(sql),
    batch: (
      statements: Parameters<Client["batch"]>[0],
      mode?: TransactionMode,
    ) => currentDb().batch(statements, mode),
    transaction: (mode?: TransactionMode) => currentDb().transaction(mode),
  },
}));

process.env.EA_USER_ID = "u1";
process.env.NODE_ENV = "test";

const { default: router } = await import("./dashboard.ts");
const { clearCurrentDashboardEventSubscribers } = await import("../dashboard/current-events.ts");
const { clearCurrentDashboardRefreshState } = await import("../dashboard/current-service.ts");
const { saveCacheRow } = await import("../dashboard/currentCacheStore.ts");

function makeApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use("/api/dashboard", router);
  return app;
}

describe("dashboard routes", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-03T19:00:00.000Z"));
    testState.db.current = await createMigratedDb();
    await seedOwner(currentDb(), { userId: "u1", passwordHash: "test-password-hash" });
    await seedSession(currentDb());
    await currentDb().execute({
      sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
      args: ["u1"],
    });
    const now = new Date("2026-05-03T19:00:00.000Z");
    await saveCacheRow("u1", "weather_current", { temp: 71, summary: "Clear" }, { now });
    await saveCacheRow("u1", "calendar_current", [], { now });
    await saveCacheRow("u1", "deadlines_current", { upcoming: [], stats: { total: 0 } }, { now });
    await saveCacheRow("u1", "bills_current", {
      bills: [],
      allSchedules: [],
      payeeMap: {},
      actualConfigured: false,
      actualBudgetUrl: null,
      billsSyncHealth: { state: "unconfigured", configured: false },
    }, { now });
    clearCurrentDashboardEventSubscribers();
  });

  afterEach(async () => {
    clearCurrentDashboardEventSubscribers();
    clearCurrentDashboardRefreshState();
    await testState.db.current?.close?.();
    testState.db.current = null;
    vi.useRealTimers();
  });

  it("requires a cookie session before loading current dashboard data", async () => {
    const res = await request(makeApp()).get("/api/dashboard/current");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Not authenticated" });
  });

  it("returns the cached current-dashboard envelope through the real service", async () => {
    const res = await request(makeApp())
      .get("/api/dashboard/current")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      weather: { temp: 71, summary: "Clear" },
      calendar: [],
      deadlines: { upcoming: [], stats: { total: 0 } },
      bills: [],
      actualConfigured: false,
      refresh: {
        mode: "passive",
        scheduled: [],
        skipped: expect.arrayContaining([
          { key: "weather_current", reason: "fresh" },
          { key: "calendar_current", reason: "fresh" },
        ]),
      },
      providerHealth: { currentData: { state: "current" } },
    });
    expect(res.body.contentKey).toEqual(expect.any(String));
  });

  it("returns dashboard health from the real cache and provider projections", async () => {
    const res = await request(makeApp())
      .get("/api/dashboard/health")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      providerHealth: {
        currentData: { state: "current" },
        bills: { state: "unconfigured", configured: false },
      },
      systemStatus: { state: "current" },
    });
    expect(res.body.fetchedAt).toEqual(expect.any(String));
  });

  it("opens an authenticated SSE stream with a connected event", async () => {
    const response = await fetchApp(makeApp(), "/api/dashboard/current/events", {
      headers: { cookie: "ea_session=cookie-session" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let chunk = "";
    for (let readCount = 0; readCount < 3 && !chunk.includes("dashboard-current-connected"); readCount += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      chunk += decoder.decode(value, { stream: true });
    }

    expect(chunk).toContain("retry: 5000\n");
    expect(chunk).toContain("event: dashboard-current-connected\n");
    expect(chunk).toContain("\"type\":\"dashboard_current_connected\"");
    await reader.cancel();
  });
});
