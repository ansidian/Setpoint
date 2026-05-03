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
  updateTodoistTask: vi.fn(),
  updateCTMEventStatus: vi.fn(),
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
  createTodoistTask: (...args) => testState.createTodoistTask(...args),
  updateTodoistTask: (...args) => testState.updateTodoistTask(...args),
  fetchTodoistTaskIdSet: vi.fn(),
}));

vi.mock("../briefing/ctm.js", () => ({
  updateCTMEventStatus: (...args) => testState.updateCTMEventStatus(...args),
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

    CREATE TABLE ea_briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      briefing_json TEXT NOT NULL
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

async function seedBriefing(briefing) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_briefings (user_id, status, generated_at, briefing_json)
          VALUES (?, 'ready', ?, ?)`,
    args: ["user-1", "2026-05-03T12:00:00.000Z", JSON.stringify(briefing)],
  });
}

async function latestBriefing() {
  const result = await testState.db.current.execute({
    sql: "SELECT briefing_json FROM ea_briefings WHERE user_id = ? ORDER BY generated_at DESC LIMIT 1",
    args: ["user-1"],
  });
  return JSON.parse(result.rows[0].briefing_json);
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
    testState.updateTodoistTask.mockReset();
    testState.updateCTMEventStatus.mockReset().mockResolvedValue(undefined);
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
    await seedBriefing({
      todoist: { upcoming: [task], stats: {} },
      ctm: { upcoming: [], stats: {} },
    });

    const res = await request(makeApp())
      .post("/api/briefing/complete-task/td-rec")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(res.status).toBe(200);
    expect(testState.completeTodoistTask).toHaveBeenCalledWith("user-1", "td-rec");

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

    const stored = await latestBriefing();
    expect(stored.todoist.upcoming).toHaveLength(1);
    expect(stored.todoist.upcoming[0]).toMatchObject({
      id: "td-rec",
      status: "incomplete",
    });
  });

  it("returns 502 without inserting a dedupe row when Todoist close fails", async () => {
    testState.completeTodoistTask.mockRejectedValueOnce(new Error("Todoist API 401: bad token"));
    await seedBriefing({
      todoist: {
        upcoming: [{
          id: "td-fail",
          title: "One-off",
          due_date: "2026-04-18",
          source: "todoist",
          is_recurring: false,
          status: "incomplete",
        }],
        stats: {},
      },
      ctm: { upcoming: [], stats: {} },
    });

    const res = await request(makeApp())
      .post("/api/briefing/complete-task/td-fail")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.message).toBe("Todoist close failed: Todoist API 401: bad token");
    expect(await completedTaskRows()).toHaveLength(0);
    expect((await latestBriefing()).todoist.upcoming).toHaveLength(1);
  });

  it("mirrors a newly created Todoist task into the stored briefing so completion can close it", async () => {
    testState.createTodoistTask.mockResolvedValueOnce({
      id: "td-new",
      title: "Pick up milk",
      due_date: "2026-04-18",
      source: "todoist",
      is_recurring: false,
    });
    await seedBriefing({
      todoist: { upcoming: [], stats: {} },
      ctm: { upcoming: [], stats: {} },
    });

    const createRes = await request(makeApp())
      .post("/api/briefing/todoist/tasks")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ content: "Pick up milk" });

    expect(createRes.status).toBe(200);
    expect((await latestBriefing()).todoist.upcoming[0]).toMatchObject({ id: "td-new" });

    const completeRes = await request(makeApp())
      .post("/api/briefing/complete-task/td-new")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(completeRes.status).toBe(200);
    expect(testState.completeTodoistTask).toHaveBeenCalledWith("user-1", "td-new");
    const rows = await completedTaskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ todoist_id: "td-new", due_date: null, snapshot_json: null });
  });

  it("records legacy dedupe state and marks non-recurring Todoist-only tasks complete", async () => {
    await seedBriefing({
      todoist: {
        upcoming: [{
          id: "td-one",
          title: "One-off",
          due_date: "2026-04-18",
          source: "todoist",
          is_recurring: false,
          status: "incomplete",
        }],
        stats: {},
      },
      ctm: { upcoming: [], stats: {} },
    });

    const res = await request(makeApp())
      .post("/api/briefing/complete-task/td-one")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({});

    expect(res.status).toBe(200);
    const rows = await completedTaskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ todoist_id: "td-one", due_date: null, snapshot_json: null });

    const stored = await latestBriefing();
    expect(stored.todoist.upcoming).toHaveLength(1);
    expect(stored.todoist.upcoming[0]).toMatchObject({
      id: "td-one",
      status: "complete",
    });
  });
});
