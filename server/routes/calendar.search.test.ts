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

// test-architecture: allow-boundary-mock -- injects an ephemeral database while real route, search, mirror, and deadline services execute together.
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

// test-architecture: allow-boundary-mock -- Todoist is the outbound provider boundary for deadline overlays.
vi.mock("../tasks/todoist.ts", () => todoistProvider);

process.env.EA_USER_ID = "user-1";
process.env.NODE_ENV = "test";

const calendarRoutes = (await import("./calendar.ts")).default;
const calendarSearchMirror = await import("../calendar/calendar-search-mirror.ts");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/calendar", calendarRoutes);
  return app;
}

function authenticated() {
  return ["ea_session=cookie-session"];
}

const event = {
  id: "event-1",
  title: "Final presentation",
  startMs: Date.parse("2026-05-20T17:00:00.000Z"),
  endMs: Date.parse("2026-05-20T18:00:00.000Z"),
  time: "10:00 AM",
  duration: "1h",
  source: "School",
  sourceColor: "#4285f4",
  accountId: "gmail-main",
  accountLabel: "Google Main",
  accountEmail: "me@example.com",
  calendarId: "primary",
  calendarName: "School",
  allDay: false,
  originalStartTime: "2026-05-20T17:00:00.000Z",
  openUrl: "https://calendar.google.com/event",
};

async function seedEventMirror() {
  await currentDb().execute({
    sql: `INSERT INTO ea_calendar_search_mirror_state
            (user_id, account_id, calendar_id, account_label, account_email,
             calendar_label, source_color, window_start, window_end, status,
             last_sync_at, last_success_at, last_full_sync_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?)`,
    args: [
      "user-1",
      "gmail-main",
      "primary",
      "Google Main",
      "me@example.com",
      "School",
      "#4285f4",
      "2025-05-03",
      "2027-11-03",
      "2026-05-03T18:59:00.000Z",
      "2026-05-03T18:59:00.000Z",
      "2026-05-03T18:59:00.000Z",
      "2026-05-03T18:59:00.000Z",
    ],
  });
  await calendarSearchMirror.upsertCalendarSearchMirrorOccurrence("user-1", event, {
    dbClient: currentDb(),
    now: new Date("2026-05-03T18:59:00.000Z"),
    recordPendingSync: false,
  });
}

describe("GET /api/calendar/search", () => {
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
              (id, user_id, type, email, label, calendar_enabled)
            VALUES (?, ?, 'gmail', ?, ?, 1)`,
      args: ["gmail-main", "user-1", "me@example.com", "Google Main"],
    });
    await seedEventMirror();
    todoistProvider.fetchTodoistDueTaskIdSet.mockReset().mockResolvedValue(new Set(["deadline-1"]));
    todoistProvider.fetchTodoistTasks.mockReset().mockResolvedValue([]);
    todoistProvider.fetchTodoistTasksAll.mockReset().mockResolvedValue([]);
    todoistProvider.fetchTodoistTasksRange.mockReset().mockResolvedValue([{
      id: "deadline-1",
      title: "Final project upload",
      due_date: "2026-05-19",
      due_time: null,
      status: "incomplete",
      source: "todoist",
      description: "",
      url: null,
      labels: [],
      is_recurring: false,
    }]);
    todoistProvider.getTodoistSyncHealth.mockReset().mockResolvedValue({
      state: "current",
      configured: true,
      ageMs: 30_000,
    });
  });

  afterEach(async () => {
    calendarSearchMirror.stopCalendarSearchMirrorSyncWorker();
    await testState.db.current?.close?.();
    testState.db.current = null;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns durable mirror events and deadline overlays through the real search service", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/search?scope=events&q=final")
      .set("Cookie", authenticated());

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "deadline",
        id: "deadline:deadline-1:2026-05-19",
        title: "Final project upload",
        sourceLabel: "Deadline",
        payload: expect.objectContaining({ id: "deadline-1", dueDate: "2026-05-19" }),
      }),
      expect.objectContaining({
        type: "event",
        itemId: "event-1",
        itemDate: "2026-05-20",
        title: "Final presentation",
        sourceLabel: "School",
        activation: expect.objectContaining({ accountId: "gmail-main", calendarId: "primary" }),
      }),
    ]));
    expect(res.body.coverage.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "google_calendar",
        searched: true,
        strategy: "local_mirror",
        syncHealth: expect.objectContaining({ state: "current" }),
      }),
      expect.objectContaining({ key: "deadlines", searched: true }),
    ]));
  });

  it("returns usable event rows with stale mirror coverage", async () => {
    await currentDb().execute({
      sql: "UPDATE ea_calendar_search_mirror_state SET status = 'stale', last_success_at = ? WHERE user_id = ?",
      args: ["2026-04-01T18:59:00.000Z", "user-1"],
    });

    const res = await request(makeApp())
      .get("/api/calendar/search?scope=events&q=final")
      .set("Cookie", authenticated());

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "event", itemId: "event-1" }),
    ]));
    expect(res.body.coverage.sources[0]).toMatchObject({
      key: "google_calendar",
      searched: true,
      syncHealth: expect.objectContaining({ state: "stale" }),
    });
  });

  it("returns a cheap empty response for short queries", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/search?scope=events&q=f")
      .set("Cookie", authenticated());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      query: "f",
      scope: "events",
      results: [],
      resultCount: 0,
      totalMatches: 0,
      truncated: false,
      coverage: { scope: "events", reason: "query_too_short", sources: [] },
    });
  });

  it("rejects invalid scopes at the HTTP boundary", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/search?scope=all&q=final")
      .set("Cookie", authenticated());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "calendar_search_scope_invalid",
      message: "scope must be events or bills",
    });
  });

  it("returns mirrored bill occurrences through the real bills search path", async () => {
    await currentDb().execute({
      sql: `INSERT INTO ea_bills_mirror_state
              (user_id, status, actual_configured, actual_budget_url, last_success_at)
            VALUES (?, 'current', 1, ?, ?)`,
      args: ["user-1", "http://actual.local", "2026-05-03T18:59:00.000Z"],
    });
    await currentDb().execute({
      sql: `INSERT INTO ea_bill_occurrence_mirror
              (user_id, occurrence_id, schedule_id, occurrence_date, name, payee, amount, type, paid)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'bill', 0)`,
      args: ["user-1", "schedule-rent:2026-05-15", "schedule-rent", "2026-05-15", "Rent", "Apartment", 1900],
    });

    const res = await request(makeApp())
      .get("/api/calendar/search?scope=bills&q=rent")
      .set("Cookie", authenticated());

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({
        type: "bill",
        itemId: "schedule-rent:2026-05-15",
        itemDate: "2026-05-15",
        title: "Rent",
        sourceLabel: "Bills",
        activation: expect.objectContaining({ view: "bills", scheduleId: "schedule-rent" }),
      }),
    ]);
    expect(res.body.coverage.sources).toEqual([
      expect.objectContaining({
        key: "bills_mirror",
        syncHealth: expect.objectContaining({ state: "current" }),
        actualBudgetUrl: "http://actual.local",
      }),
    ]);
  });
});
