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
  completeTodoistTask: vi.fn(),
  createTodoistTask: vi.fn(),
  deleteTodoistTask: vi.fn(),
  fetchTodoistDueTaskIdSet: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  fetchTodoistProjects: vi.fn(),
  fetchTodoistLabels: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
  updateTodoistTask: vi.fn(),
}));

function currentDb(): Client {
  if (!testState.db.current) throw new Error("Test database is not initialized");
  return testState.db.current;
}

// test-architecture: allow-boundary-mock -- injects an ephemeral database while real route and service modules execute together.
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

// test-architecture: allow-boundary-mock -- Todoist is the outbound provider boundary for the real deadline service.
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

function authenticatedRequest() {
  return request(makeApp());
}

describe("calendar deadline mutation routes", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    await seedOwner(currentDb(), { passwordHash: "test-password-hash" });
    await seedSession(currentDb());
    todoistProvider.completeTodoistTask.mockReset().mockResolvedValue(undefined);
    todoistProvider.createTodoistTask.mockReset().mockResolvedValue({ id: "td-new", title: "Pay invoice" });
    todoistProvider.deleteTodoistTask.mockReset().mockResolvedValue(undefined);
    todoistProvider.fetchTodoistTasksAll.mockReset().mockResolvedValue([]);
    todoistProvider.getTodoistSyncHealth.mockReset().mockResolvedValue({
      state: "current",
      configured: true,
      ageMs: 30_000,
    });
    todoistProvider.updateTodoistTask.mockReset().mockResolvedValue({ id: "td-1", title: "Renamed" });
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
    vi.clearAllMocks();
  });

  it("returns the created deadline through the real task service", async () => {
    const res = await authenticatedRequest()
      .post("/api/calendar/deadlines")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        title: "Pay invoice",
        dueDate: "2026-05-12",
        dueTime: "2:00 PM",
        projectId: "project-1",
        labelIds: ["finance"],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ deadline: { id: "td-new", title: "Pay invoice" } });
  });

  it("returns the updated deadline through the real task service", async () => {
    const res = await authenticatedRequest()
      .patch("/api/calendar/deadlines/td-1")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ title: "Renamed", dueString: "tomorrow at 9am" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deadline: { id: "td-1", title: "Renamed" } });
  });

  it("returns the delete HTTP contract through the real task service", async () => {
    const res = await authenticatedRequest()
      .delete("/api/calendar/deadlines/td-1")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("persists a completed occurrence before returning the route result", async () => {
    todoistProvider.fetchTodoistTasksAll.mockResolvedValueOnce([{
      id: "td-rec",
      title: "Weekly review",
      due_date: "2026-05-12",
      status: "incomplete",
    }]);

    const res = await authenticatedRequest()
      .post("/api/calendar/deadlines/td-rec/completed-occurrences/2026-05-12")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    const completed = await currentDb().execute({
      sql: "SELECT todoist_id, due_date FROM ea_completed_tasks WHERE user_id = ?",
      args: ["user-1"],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      completed: true,
      alreadyCompleted: false,
      deadlineId: "td-rec",
      occurrenceDate: "2026-05-12",
    });
    expect(completed.rows).toEqual([{ todoist_id: "td-rec", due_date: "2026-05-12" }]);
  });

  it("rejects an invalid occurrence date at the HTTP boundary", async () => {
    const res = await authenticatedRequest()
      .post("/api/calendar/deadlines/td-rec/completed-occurrences/not-a-date")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Deadline occurrence date must be YYYY-MM-DD" });
  });
});
