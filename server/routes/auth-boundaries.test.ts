import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, InStatement, TransactionMode } from "@libsql/client";
import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createMigratedDb } from "../triage/triage-worker.test-utils.ts";
import { hashApiToken, seedOwner, seedSession } from "../test-utils/auth-db.ts";

const testState: { db: Client | null } = { db: null };

function currentDb(): Client {
  if (!testState.db) throw new Error("Test database is not initialized");
  return testState.db;
}

// test-architecture: allow-boundary-mock -- injects an ephemeral database while the real auth middleware and route stacks execute together.
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

process.env.EA_USER_ID = "user-1";
process.env.EA_ENCRYPTION_KEY = "11".repeat(32);

const briefingRoutes = (await import("./briefing/index.ts")).default;
const dashboardRoutes = (await import("./dashboard.ts")).default;
const settingsRoutes = (await import("./settings.ts")).default;
const tldrawRoutes = (await import("./tldraw.ts")).default;
const { requireCookieSession } = await import("../middleware/auth.ts");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", briefingRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/ea", requireCookieSession, settingsRoutes);
  app.use("/api/tldraw", tldrawRoutes);
  return app;
}

function cookie() {
  return ["ea_session=cookie-session"];
}

async function seedBearer(scopes: string[] = ["actual:write"]) {
  await currentDb().execute({
    sql: `INSERT INTO ea_api_tokens
            (token_hash, label, scopes, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      hashApiToken("scoped-token"),
      "Shortcut",
      JSON.stringify(scopes),
      Date.now(),
      Date.now() + 60_000,
    ],
  });
}

beforeEach(async () => {
  testState.db = await createMigratedDb();
  await seedOwner(currentDb(), { passwordHash: "test-password-hash" });
  await seedSession(currentDb());
  await currentDb().execute({
    sql: "INSERT INTO ea_settings (user_id, email_triage_mode) VALUES (?, 'auto')",
    args: ["user-1"],
  });
});

afterEach(async () => {
  await testState.db?.close?.();
  testState.db = null;
});

describe("auth boundaries", () => {
  it("rejects bearer auth on cookie-only operational routes", async () => {
    await seedBearer();
    const routes = [
      ["get", "/api/briefing/email-index/health"],
      ["get", "/api/dashboard/current"],
      ["get", "/api/ea/settings"],
      ["get", "/api/tldraw/bootstrap"],
      ["get", "/api/briefing/actual/metadata"],
    ] as const;

    for (const [method, path] of routes) {
      const res = await request(makeApp())[method](path)
        .set("Authorization", "Bearer scoped-token");
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });

  it("rejects missing and expired cookie sessions before route handlers run", async () => {
    const missing = await request(makeApp()).get("/api/tldraw/bootstrap");
    expect(missing.status).toBe(401);

    await currentDb().execute({
      sql: "UPDATE ea_sessions SET expires_at = ?",
      args: [Date.now() - 1],
    });
    const expired = await request(makeApp())
      .get("/api/tldraw/bootstrap")
      .set("Cookie", cookie());
    expect(expired.status).toBe(401);
  });

  it("allows cookie sessions to reach real settings and tldraw routes", async () => {
    const settings = await request(makeApp())
      .get("/api/ea/settings")
      .set("Cookie", cookie());
    const notes = await request(makeApp())
      .get("/api/tldraw/bootstrap")
      .set("Cookie", cookie());

    expect(settings.status).toBe(200);
    expect(settings.body.email_triage_mode).toBe("auto");
    expect(settings.body).not.toHaveProperty("openai_available");
    expect(settings.body).not.toHaveProperty("embedding_count");
    expect(notes.status).toBe(200);
    expect(notes.body).toEqual({
      licenseKey: null,
      licenseRequired: false,
      document: { document: null, revision: 0, updatedAt: null },
    });
  });

  it("does not expose briefing lifecycle, history, or pin routes to cookie sessions", async () => {
    const routes = [
      ["post", "/api/briefing/pin/msg-1"],
      ["post", "/api/briefing/generate"],
      ["get", "/api/briefing/in-progress"],
      ["post", "/api/briefing/refresh"],
      ["get", "/api/briefing/latest"],
      ["get", "/api/briefing/history"],
      ["get", "/api/briefing/status/123"],
      ["get", "/api/briefing/123"],
      ["delete", "/api/briefing/123"],
    ] as const;

    for (const [method, path] of routes) {
      const res = await request(makeApp())[method](path).set("Cookie", cookie());
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
    }
  });
});
