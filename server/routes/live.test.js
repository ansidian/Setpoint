import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import express from "express";
import request from "supertest";
import { createClient } from "@libsql/client";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
  },
}));

const { default: router } = await import("./live.js");

process.env.EA_USER_ID = "u1";

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use("/api/live", router);
  return app;
}

function hashSessionToken(raw) {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

async function createSessionDb() {
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

describe("GET /api/live/all", () => {
  beforeEach(() => {
    testState.db.current = null;
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("requires a cookie session before returning the retired response", async () => {
    testState.db.current = await createSessionDb();

    const res = await request(makeApp()).get("/api/live/all");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Not authenticated" });
  });

  it("is retired for authenticated dashboard clients", async () => {
    testState.db.current = await createSessionDb();

    const res = await request(makeApp())
      .get("/api/live/all")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      code: "LIVE_ROUTE_RETIRED",
      message: "/api/live/all is retired. Use /api/dashboard/current for current dashboard data.",
    });
  });
});
