import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import express from "express";
import request from "supertest";

const testState = vi.hoisted(() => ({
  db: { current: null },
  completeTodoistTask: vi.fn(),
  createTodoistTask: vi.fn(),
  deleteTodoistTask: vi.fn(),
  fetchTodoistProjects: vi.fn(),
  fetchTodoistLabels: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchCTMDeadlinesAll: vi.fn(),
  updateTodoistTask: vi.fn(),
  updateCTMEventStatus: vi.fn(),
  applyDeadlineCurrentStatus: vi.fn(),
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
    executeMultiple: (...args) => testState.db.current.executeMultiple(...args),
  },
}));

vi.mock("../briefing/todoist.js", () => ({
  completeTodoistTask: (...args) => testState.completeTodoistTask(...args),
  deleteTodoistTask: (...args) => testState.deleteTodoistTask(...args),
  fetchTodoistProjects: (...args) => testState.fetchTodoistProjects(...args),
  fetchTodoistLabels: (...args) => testState.fetchTodoistLabels(...args),
  fetchTodoistTasksAll: (...args) => testState.fetchTodoistTasksAll(...args),
  createTodoistTask: (...args) => testState.createTodoistTask(...args),
  updateTodoistTask: (...args) => testState.updateTodoistTask(...args),
  fetchTodoistTaskIdSet: vi.fn(),
}));

vi.mock("../briefing/ctm.js", () => ({
  fetchCTMDeadlinesAll: (...args) => testState.fetchCTMDeadlinesAll(...args),
  updateCTMEventStatus: (...args) => testState.updateCTMEventStatus(...args),
}));

vi.mock("../dashboard/current-service.js", () => ({
  applyDeadlineCurrentStatus: (...args) => testState.applyDeadlineCurrentStatus(...args),
}));

process.env.EA_USER_ID = "user-1";

const { requireCookieSession } = await import("../middleware/auth.js");
const { default: tasksRouter } = await import("./briefing/tasks.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", requireCookieSession, tasksRouter);
  return app;
}

function hashSessionToken(raw) {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE ea_completed_tasks (
      user_id TEXT NOT NULL,
      todoist_id TEXT NOT NULL,
      completed_at TEXT DEFAULT (datetime('now')),
      due_date TEXT,
      snapshot_json TEXT,
      PRIMARY KEY (user_id, todoist_id, due_date)
    );
  `);
  await db.execute({
    sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
    args: [hashSessionToken("cookie-session"), Date.now() + 60_000],
  });
  return db;
}

async function completedTaskRows() {
  const result = await testState.db.current.execute({
    sql: `SELECT user_id, todoist_id, due_date, snapshot_json
          FROM ea_completed_tasks
          ORDER BY todoist_id`,
    args: [],
  });
  return result.rows;
}

describe("POST /api/briefing/complete-task/:taskId", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    testState.completeTodoistTask.mockReset().mockResolvedValue(undefined);
    testState.createTodoistTask.mockReset();
    testState.deleteTodoistTask.mockReset();
    testState.fetchTodoistProjects.mockReset();
    testState.fetchTodoistLabels.mockReset();
    testState.fetchTodoistTasksAll.mockReset().mockResolvedValue([]);
    testState.fetchCTMDeadlinesAll.mockReset().mockResolvedValue([]);
    testState.updateTodoistTask.mockReset();
    testState.updateCTMEventStatus.mockReset().mockResolvedValue(undefined);
    testState.applyDeadlineCurrentStatus.mockReset().mockResolvedValue({ updated: true });
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("requires a cookie session before completing tasks", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/complete-task/td-one")
      .send({});

    expect(res.status).toBe(401);
    expect(testState.completeTodoistTask).not.toHaveBeenCalled();
  });

  it("writes a snapshot tombstone row and leaves recurring Todoist tasks visible", async () => {
    const task = {
      id: "td-rec",
      title: "Empty dishwasher",
      due_date: "2026-04-18",
      due_time: "8:00 AM",
      class_name: "Home",
      class_color: "#884dff",
      url: "https://app.todoist.com/app/task/empty-dishwasher-td-rec",
      priority: 2,
      labels: [],
      description: "",
      source: "todoist",
      is_recurring: true,
      status: "incomplete",
    };
    testState.fetchTodoistTasksAll.mockResolvedValueOnce([task]);
    const res = await request(makeApp())
      .post("/api/briefing/complete-task/td-rec")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(res.status).toBe(200);
    expect(testState.completeTodoistTask).toHaveBeenCalledWith("user-1", "td-rec");
    expect(testState.applyDeadlineCurrentStatus).toHaveBeenCalledWith("user-1", "td-rec", "complete", {
      source: "todoist",
    });

    const rows = await completedTaskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "user-1",
      todoist_id: "td-rec",
      due_date: "2026-04-18",
    });
    const snap = JSON.parse(rows[0].snapshot_json);
    expect(snap).toMatchObject({
      title: "Empty dishwasher",
      is_recurring: true,
    });

  });

  it("returns 502 without inserting a dedupe row when Todoist close fails", async () => {
    testState.completeTodoistTask.mockRejectedValueOnce(new Error("Todoist API 401: bad token"));
    testState.fetchTodoistTasksAll.mockResolvedValueOnce([{
      id: "td-fail",
      title: "One-off",
      due_date: "2026-04-18",
      source: "todoist",
      is_recurring: false,
      status: "incomplete",
    }]);
    const res = await request(makeApp())
      .post("/api/briefing/complete-task/td-fail")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.message).toBe("Todoist close failed: Todoist API 401: bad token");
    expect(await completedTaskRows()).toHaveLength(0);
    expect(testState.applyDeadlineCurrentStatus).not.toHaveBeenCalled();
  });

  it("completes a mirror-backed Todoist task without reading latest briefing JSON", async () => {
    testState.fetchTodoistTasksAll.mockResolvedValueOnce([{
      id: "td-domain",
      title: "Submit project notes",
      due_date: "2026-05-04",
      due_time: "3:00 PM",
      class_name: "Todoist",
      class_color: "#cba6da",
      url: "https://app.todoist.com/app/task/submit-project-notes-td-domain",
      priority: 2,
      labels: ["school"],
      description: "Attach rubric notes",
      source: "todoist",
      is_recurring: false,
      status: "incomplete",
    }]);

    const res = await request(makeApp())
      .post("/api/briefing/complete-task/td-domain")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(res.status).toBe(200);
    expect(testState.completeTodoistTask).toHaveBeenCalledWith("user-1", "td-domain");

    const rows = await completedTaskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "user-1",
      todoist_id: "td-domain",
      due_date: "2026-05-04",
    });
    expect(JSON.parse(rows[0].snapshot_json)).toMatchObject({
      id: "td-domain",
      title: "Submit project notes",
      due_date: "2026-05-04",
      due_time: "3:00 PM",
      source: "todoist",
      is_recurring: false,
    });
  });

  it("can complete a newly created Todoist task once it appears in the domain source", async () => {
    const createdTask = {
      id: "td-new",
      title: "Pick up milk",
      due_date: "2026-04-18",
      source: "todoist",
      is_recurring: false,
    };
    testState.createTodoistTask.mockResolvedValueOnce(createdTask);
    const createRes = await request(makeApp())
      .post("/api/briefing/todoist/tasks")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ content: "Pick up milk" });

    expect(createRes.status).toBe(200);
    expect(createRes.body).toMatchObject({ id: "td-new" });

    testState.fetchTodoistTasksAll.mockResolvedValueOnce([createdTask]);
    const completeRes = await request(makeApp())
      .post("/api/briefing/complete-task/td-new")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(completeRes.status).toBe(200);
    expect(testState.completeTodoistTask).toHaveBeenCalledWith("user-1", "td-new");
    const rows = await completedTaskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ todoist_id: "td-new", due_date: "2026-04-18" });
    expect(JSON.parse(rows[0].snapshot_json)).toMatchObject({ id: "td-new", title: "Pick up milk" });
  });

  it("stores a completed-task snapshot for non-recurring Todoist-only tasks", async () => {
    const task = {
      id: "td-one",
      title: "One-off",
      due_date: "2026-04-18",
      source: "todoist",
      is_recurring: false,
      status: "incomplete",
    };
    testState.fetchTodoistTasksAll.mockResolvedValueOnce([task]);
    const res = await request(makeApp())
      .post("/api/briefing/complete-task/td-one")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(res.status).toBe(200);
    const rows = await completedTaskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ todoist_id: "td-one", due_date: "2026-04-18" });
    expect(JSON.parse(rows[0].snapshot_json)).toMatchObject({
      id: "td-one",
      title: "One-off",
      source: "todoist",
      is_recurring: false,
    });

  });
});

describe("PATCH /api/briefing/task-status/:taskId", () => {
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    testState.completeTodoistTask.mockReset();
    testState.createTodoistTask.mockReset();
    testState.deleteTodoistTask.mockReset();
    testState.fetchTodoistProjects.mockReset();
    testState.fetchTodoistLabels.mockReset();
    testState.fetchTodoistTasksAll.mockReset().mockResolvedValue([]);
    testState.fetchCTMDeadlinesAll.mockReset().mockResolvedValue([]);
    testState.updateTodoistTask.mockReset();
    testState.updateCTMEventStatus.mockReset().mockResolvedValue(undefined);
    testState.applyDeadlineCurrentStatus.mockReset().mockResolvedValue({ updated: true });
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("writes successful CTM status changes through to current deadline cache", async () => {
    const res = await request(makeApp())
      .patch("/api/briefing/task-status/ctm-one")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ status: "complete" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "complete" });
    expect(testState.updateCTMEventStatus).toHaveBeenCalledWith("ctm-one", "complete");
    expect(testState.applyDeadlineCurrentStatus).toHaveBeenCalledWith("user-1", "ctm-one", "complete", {
      source: "ctm",
    });
  });

  it("does not update current deadline cache when the CTM mutation fails", async () => {
    const err = new Error("Invalid status");
    err.status = 400;
    testState.updateCTMEventStatus.mockRejectedValueOnce(err);

    const res = await request(makeApp())
      .patch("/api/briefing/task-status/ctm-one")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ status: "bad" });

    expect(res.status).toBe(400);
    expect(testState.applyDeadlineCurrentStatus).not.toHaveBeenCalled();
  });
});
