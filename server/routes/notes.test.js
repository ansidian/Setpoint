// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import express from "express";
import request from "supertest";

const testState = vi.hoisted(() => ({
  db: { current: null },
  batchSpy: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    executeMultiple: (...args) => testState.db.current.executeMultiple(...args),
    batch: (...args) => {
      testState.batchSpy(...args);
      return testState.db.current.batch(...args);
    },
  },
}));

process.env.EA_USER_ID = "u1";

const { default: router } = await import("./notes.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/notes", router);
  return app;
}

async function createNotesDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

async function seedNote(db, content, sortOrder) {
  await db.execute({
    sql: "INSERT INTO ea_notes (user_id, content, sort_order) VALUES (?, ?, ?)",
    args: ["u1", content, sortOrder],
  });
}

async function readNotes(db) {
  const result = await db.execute({
    sql: "SELECT id, content, sort_order FROM ea_notes WHERE user_id = ? ORDER BY sort_order",
    args: ["u1"],
  });
  return result.rows;
}

describe("notes routes", () => {
  beforeEach(async () => {
    testState.db.current = await createNotesDb();
    testState.batchSpy.mockReset();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("creates a note at sort_order 0 and shifts prior notes by one", async () => {
    // Seeded in display order: slot 0 is the top of the list, slot 1 below it.
    await seedNote(testState.db.current, "top-existing", 0);
    await seedNote(testState.db.current, "below-existing", 1);

    const res = await request(makeApp()).post("/api/notes").send({ content: "freshest" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ content: "freshest", sort_order: 0 });
    expect(res.body.id).toBeGreaterThan(0);

    const rows = await readNotes(testState.db.current);
    // Exactly one new row at slot 0; each prior note shifted up by one, none lost.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.content, r.sort_order])).toEqual([
      ["freshest", 0],
      ["top-existing", 1],
      ["below-existing", 2],
    ]);
    // The returned id matches the persisted row at slot 0.
    expect(rows[0].id).toBe(res.body.id);
  });

  it("issues the shift and insert as a single transactional batch", async () => {
    await seedNote(testState.db.current, "older", 0);

    await request(makeApp()).post("/api/notes").send({ content: "newest" });

    // One batch call carrying both writes (UPDATE then INSERT), not two execute() calls.
    expect(testState.batchSpy).toHaveBeenCalledTimes(1);
    const statements = testState.batchSpy.mock.calls[0][0];
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toMatch(/UPDATE ea_notes SET sort_order = sort_order \+ 1/);
    expect(statements[1].sql).toMatch(/INSERT INTO ea_notes/);
  });

  it("rejects blank content without touching the database", async () => {
    await seedNote(testState.db.current, "older", 0);

    const res = await request(makeApp()).post("/api/notes").send({ content: "   " });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Content is required" });
    expect(testState.batchSpy).not.toHaveBeenCalled();

    const rows = await readNotes(testState.db.current);
    expect(rows).toHaveLength(1);
    expect(rows[0].sort_order).toBe(0);
  });

  it("archives a note (sets archived_at)", async () => {
    await seedNote(testState.db.current, "promote me", 0);
    const id = (await readNotes(testState.db.current))[0].id;

    const res = await request(makeApp()).patch(`/api/notes/${id}/archive`).send({ archived: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const list = await request(makeApp()).get("/api/notes");
    const row = list.body.find((n) => n.id === id);
    // Guard the contract, not just presence: both must hold a real datetime string.
    expect(row.archived_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("unarchives a note (clears archived_at and re-bumps updated_at)", async () => {
    await seedNote(testState.db.current, "back to active", 0);
    const id = (await readNotes(testState.db.current))[0].id;
    await request(makeApp()).patch(`/api/notes/${id}/archive`).send({ archived: true });

    await request(makeApp()).patch(`/api/notes/${id}/archive`).send({ archived: false });

    const list = await request(makeApp()).get("/api/notes");
    const row = list.body.find((n) => n.id === id);
    expect(row.archived_at).toBeNull();
    // The clear path also bumps updated_at ("always bumps updated_at").
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("bumps updated_at when content is edited", async () => {
    await seedNote(testState.db.current, "old text", 0);
    const id = (await readNotes(testState.db.current))[0].id;

    const res = await request(makeApp()).patch(`/api/notes/${id}`).send({ content: "new text" });

    expect(res.status).toBe(200);
    const list = await request(makeApp()).get("/api/notes");
    expect(list.body.find((n) => n.id === id).updated_at).not.toBeNull();
  });
});
