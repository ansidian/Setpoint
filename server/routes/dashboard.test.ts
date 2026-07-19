import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import express, { type Express } from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import request, { type Test } from "supertest";

interface DashboardRouteTestState {
  db: { current: Client | null };
  getCurrentDashboard: Mock<(...args: unknown[]) => unknown>;
  getDashboardSystemHealth: Mock<(...args: unknown[]) => unknown>;
  requestCurrentDashboardRefresh: Mock<(...args: unknown[]) => unknown>;
  syncCurrentDashboard: Mock<(...args: unknown[]) => unknown>;
}

const testState = vi.hoisted((): DashboardRouteTestState => ({
  db: { current: null },
  getCurrentDashboard: vi.fn(),
  getDashboardSystemHealth: vi.fn(),
  requestCurrentDashboardRefresh: vi.fn(),
  syncCurrentDashboard: vi.fn(),
}));

vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => testState.db.current!.execute(statement),
    executeMultiple: (sql: string) => testState.db.current!.executeMultiple(sql),
    batch: (statements: InStatement[]) => testState.db.current!.batch(statements),
  },
}));

vi.mock("../dashboard/current-service.ts", () => ({
  getCurrentDashboard: (...args: unknown[]) => testState.getCurrentDashboard(...args),
  getDashboardSystemHealth: (...args: unknown[]) => testState.getDashboardSystemHealth(...args),
  requestCurrentDashboardRefresh: (...args: unknown[]) => testState.requestCurrentDashboardRefresh(...args),
  syncCurrentDashboard: (...args: unknown[]) => testState.syncCurrentDashboard(...args),
}));

process.env.EA_USER_ID = "u1";

const { default: router } = await import("./dashboard.ts");
const { clearCurrentDashboardEventSubscribers } = await import("../dashboard/current-events.ts");
const { __clearSessionValidationCache } = await import("../middleware/auth.ts");

function makeApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use("/api/dashboard", router);
  return app;
}

function listen(app: Express): Promise<Server> {
  return new Promise<Server>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function hashSessionToken(raw: string): string {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);
  await db.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [hashSessionToken("cookie-session"), Date.now() + 60_000],
  });
  return db;
}

function auth(requestBuilder: Test): Test {
  return requestBuilder.set("Cookie", ["ea_session=cookie-session"]);
}

describe("dashboard routes", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    clearCurrentDashboardEventSubscribers();
    // auth.js keeps a module-level, 30s-TTL positive sessionValidationCache keyed
    // by the hashed cookie token. A sibling test that authenticates "cookie-session"
    // leaves a positive entry behind; without this reset a later test could be served
    // a stale positive validation from cache instead of re-reading this test's DB,
    // making an unauthenticated/revoked request wrongly pass. Clear it so every test
    // re-validates against its own freshly migrated session table.
    __clearSessionValidationCache();
    testState.getCurrentDashboard.mockReset().mockResolvedValue({ weather: { temp: 71 } });
    testState.getDashboardSystemHealth.mockReset().mockResolvedValue({ systemStatus: { state: "current" } });
    testState.requestCurrentDashboardRefresh.mockReset().mockResolvedValue({
      refresh: { mode: "manual", scheduled: [], skipped: [] },
    });
    testState.syncCurrentDashboard.mockReset().mockResolvedValue({ weather: { temp: 80 } });
  });

  afterEach(async () => {
    clearCurrentDashboardEventSubscribers();
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("requires a cookie session before loading current dashboard data", async () => {
    const res = await request(makeApp()).get("/api/dashboard/current");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Not authenticated" });
    expect(testState.getCurrentDashboard).not.toHaveBeenCalled();
  });

  it("routes current dashboard reads to the current-dashboard service", async () => {
    const res = await auth(request(makeApp()).get("/api/dashboard/current"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weather: { temp: 71 } });
    expect(testState.getCurrentDashboard).toHaveBeenCalledWith("u1");
  });

  it("routes dashboard health reads to the current-dashboard service", async () => {
    const res = await auth(request(makeApp()).get("/api/dashboard/health"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ systemStatus: { state: "current" } });
    expect(testState.getDashboardSystemHealth).toHaveBeenCalledWith("u1");
  });

  it("routes manual refresh requests to the current-dashboard service", async () => {
    const res = await auth(request(makeApp()).post("/api/dashboard/current/refresh"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ refresh: { mode: "manual", scheduled: [], skipped: [] } });
    expect(testState.requestCurrentDashboardRefresh).toHaveBeenCalledWith("u1");
  });

  it("routes force sync requests to the current-dashboard service", async () => {
    const res = await auth(request(makeApp()).post("/api/dashboard/current/sync"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weather: { temp: 80 } });
    expect(testState.syncCurrentDashboard).toHaveBeenCalledWith("u1");
  });

  it("translates current-dashboard service failures to route errors", async () => {
    testState.getCurrentDashboard.mockRejectedValueOnce(new Error("service down"));

    const res = await auth(request(makeApp()).get("/api/dashboard/current"));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Failed to fetch current dashboard data" });
  });

  it("requires a cookie session before opening the current-dashboard event stream", async () => {
    const res = await request(makeApp()).get("/api/dashboard/current/events");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Not authenticated" });
  });

  it("opens an authenticated SSE stream with a connected event", async () => {
    const server = await listen(makeApp());
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/current/events`, {
      headers: { cookie: "ea_session=cookie-session" },
    });

    try {
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
    } finally {
      server.closeAllConnections?.();
      await closeServer(server);
    }
  });
});
