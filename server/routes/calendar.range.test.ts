import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { seedOwner, seedSession } from "../test-utils/auth-db.ts";

const testState = vi.hoisted<{ db: { current: Client | null } }>(() => ({
  db: { current: null },
}));

const calendarProvider = vi.hoisted(() => ({
  getAuthorizedAccount: vi.fn(),
  googleCalendarFetch: vi.fn(),
  listCalendarsForAccount: vi.fn(),
}));

const todoistProvider = vi.hoisted(() => ({
  fetchTodoistDueTaskIdSet: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

// test-architecture: allow-boundary-mock -- injects an ephemeral database while real route and domain services execute together.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: InStatement) => currentDb().execute(statement),
    batch: (
      statements: Parameters<Client["batch"]>[0],
      mode?: TransactionMode,
    ) => currentDb().batch(statements, mode),
    transaction: (mode?: TransactionMode) => currentDb().transaction(mode),
  },
}));

// test-architecture: allow-boundary-mock -- Google Calendar remains an outbound HTTP/provider adapter while calendar range logic stays real.
vi.mock("../calendar/calendar-google-client.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  getAuthorizedAccount: (...args: unknown[]) => calendarProvider.getAuthorizedAccount(...args),
  googleCalendarFetch: (...args: unknown[]) => calendarProvider.googleCalendarFetch(...args),
  listCalendarsForAccount: (...args: unknown[]) => calendarProvider.listCalendarsForAccount(...args),
}));

// test-architecture: allow-boundary-mock -- Todoist remains the outbound provider adapter for real deadline reads.
vi.mock("../tasks/todoist.ts", () => todoistProvider);

process.env.EA_USER_ID = "user-1";
process.env.NODE_ENV = "test";

const calendarRoutes = (await import("./calendar.ts")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/calendar", calendarRoutes);
  return app;
}

function auth() {
  return ["ea_session=cookie-session"];
}

function googleResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe("Calendar range routes", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-03T19:00:00.000Z"));
    testState.db.current = await createMigratedDb();
    await seedOwner(currentDb(), { passwordHash: "test-password-hash" });
    await seedSession(currentDb());
    await currentDb().execute({
      sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
      args: ["user-1"],
    });
    await currentDb().execute({
      sql: `INSERT INTO ea_accounts
              (id, user_id, type, email, label, calendar_enabled, credentials_encrypted)
            VALUES (?, ?, 'gmail', ?, ?, 1, ?)`,
      args: ["gmail-main", "user-1", "me@example.com", "Google", "provider-test-credentials"],
    });
    calendarProvider.getAuthorizedAccount.mockReset().mockResolvedValue({
      accessToken: "access-token",
      credentials: { access_token: "access-token", scopes: ["https://www.googleapis.com/auth/calendar.events"] },
      hasWriteScope: true,
    });
    calendarProvider.listCalendarsForAccount.mockReset().mockResolvedValue([{
      id: "primary",
      summary: "Personal",
      backgroundColor: "#4285f4",
      accessRole: "owner",
      primary: true,
      writable: true,
    }]);
    calendarProvider.googleCalendarFetch.mockReset().mockResolvedValue(googleResponse({
      items: [{
        id: "event-1",
        summary: "Test event",
        start: { dateTime: "2026-04-20T17:00:00.000Z" },
        end: { dateTime: "2026-04-20T18:00:00.000Z" },
      }],
    }));
    todoistProvider.fetchTodoistDueTaskIdSet.mockReset().mockResolvedValue(new Set(["todo-1", "todo-recurring"]));
    todoistProvider.fetchTodoistTasks.mockReset().mockResolvedValue([]);
    todoistProvider.fetchTodoistTasksAll.mockReset().mockResolvedValue([]);
    todoistProvider.fetchTodoistTasksRange.mockReset().mockResolvedValue([
      { id: "todo-1", title: "Standalone item", due_date: "2026-05-05", status: "incomplete" },
    ]);
    todoistProvider.getTodoistSyncHealth.mockReset().mockResolvedValue({
      state: "current",
      configured: true,
      ageMs: 30_000,
    });
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns 400 when the event range is incomplete", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/range?end=2026-04-25")
      .set("Cookie", auth());

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/start/i);
  });

  it("returns provider events through the real Calendar range service", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/range?start=2026-04-18&end=2026-04-25")
      .set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([
      expect.objectContaining({
        id: "event-1",
        title: "Test event",
        accountId: "gmail-main",
        calendarId: "primary",
      }),
    ]);
    expect(res.body.fetchedAt).toBe("2026-05-03T19:00:00.000Z");
  });

  it("returns domain-shaped deadline rows and the route range envelope", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/deadlines/range?start=2026-04-26&end=2026-06-06")
      .set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body.upcoming).toEqual([
      expect.objectContaining({
        id: "todo-1",
        title: "Standalone item",
        source: "todoist",
        sourceLabel: "Todoist",
        color: "#e44332",
        sourceColor: "#e44332",
      }),
    ]);
    expect(res.body.stats).toMatchObject({ incomplete: 1 });
    expect(res.body.syncHealth).toMatchObject({ state: "current", configured: true });
    expect(res.body.minDate).toBe("2025-05-03");
    expect(res.body.errors).toEqual([]);
    expect(res.body.fetchedAt).toBe("2026-05-03T19:00:00.000Z");
  });

  it("keeps the deadline HTTP response usable when Todoist range reads fail", async () => {
    todoistProvider.fetchTodoistTasksRange.mockRejectedValueOnce(new Error("Todoist down"));

    const res = await request(makeApp())
      .get("/api/calendar/deadlines/range?start=2026-04-26&end=2026-06-06")
      .set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body.upcoming).toEqual([]);
    expect(res.body.errors).toEqual([{ source: "todoist", message: "Todoist down" }]);
    expect(res.body.syncHealth).toMatchObject({ state: "current" });
  });
});
