import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express from "express";
import request from "../../test-utils/supertest.ts";
import type { Client } from "@libsql/client";
import { createMigratedDb } from "../../snapshots/snapshot-test-fixtures.ts";
import { seedOwner, seedSession } from "../../test-utils/auth-db.ts";
import {
  createRequireCookieSession,
  createRequireRecentPasswordAuth,
} from "../../middleware/auth.ts";
import { createActualConnectionRouter } from "./actual-connection.ts";

const mockActualService = {
  testConnection: vi.fn(),
  saveActualConnection: vi.fn(),
  removeActualConnection: vi.fn(),
  hydrateActualCache: vi.fn(),
  getActualCacheStatus: vi.fn(),
};

process.env.EA_USER_ID = "user-1";

let db: Client;

function makeApp() {
  const router = createActualConnectionRouter({
    service: mockActualService as never,
    recentAuth: createRequireRecentPasswordAuth(db),
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", createRequireCookieSession(db), router);
  return app;
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createMigratedDb();
  await seedOwner(db, { userId: "user-1", passwordHash: "hash" });
  const now = Date.now();
  await seedSession(db, "cookie-session", now + 60_000, now, {
    authMethod: "password",
    passwordAuthenticatedAt: now,
  });
});

afterEach(() => db.close());

describe("Actual connection routes", () => {
  it("hydrates the Actual cache through briefing cookie auth", async () => {
    mockActualService.hydrateActualCache.mockResolvedValueOnce({
      success: true,
      hydrated: true,
      budgetId: "My-Finances-d8e502a",
      dbSizeBytes: 50_000_000,
      backupCount: 1,
    });

    const res = await request(makeApp())
      .post("/api/briefing/actual/cache/hydrate")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      hydrated: true,
      budgetId: "My-Finances-d8e502a",
      dbSizeBytes: 50_000_000,
      backupCount: 1,
    });
  });

  it("rejects a dangerous-scheme serverURL for /actual/test without calling the Actual service (SEC-05)", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/actual/test")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ serverURL: "gopher://internal", password: "pw", syncId: "sync-1" });

    expect(res.status).toBe(400);
  });

  it("validates and saves an Actual connection candidate in one provider-owned request", async () => {
    mockActualService.saveActualConnection.mockResolvedValueOnce({
      success: true,
      budgetCount: 1,
      budgetFound: true,
    });

    const res = await request(makeApp())
      .post("/api/briefing/actual/connection")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        serverURL: "https://actual.example.test",
        password: "candidate-password",
        syncId: "candidate-sync",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, budgetCount: 1, budgetFound: true });
  });

  it("requires recent password authentication for Actual connection changes", async () => {
    await db.execute("UPDATE ea_sessions SET password_authenticated_at = 0");

    const res = await request(makeApp())
      .post("/api/briefing/actual/connection")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({
        serverURL: "https://actual.example.test",
        password: "candidate-password",
        syncId: "candidate-sync",
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      code: "PASSWORD_STEP_UP_REQUIRED",
      message: "Confirm your password to continue",
    });
  });

  it("removes the Actual connection through an effect-specific endpoint", async () => {
    mockActualService.removeActualConnection.mockResolvedValueOnce({ success: true });
    const res = await request(makeApp())
      .delete("/api/briefing/actual/connection")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it("validates the local Actual cache through briefing cookie auth", async () => {
    mockActualService.getActualCacheStatus.mockResolvedValueOnce({
      success: true,
      configured: true,
      hydrated: true,
      budgetId: "My-Finances-d8e502a",
      dbSizeBytes: 50_000_000,
      backupCount: 1,
    });

    const res = await request(makeApp())
      .get("/api/briefing/actual/cache/status")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      configured: true,
      hydrated: true,
      budgetId: "My-Finances-d8e502a",
      dbSizeBytes: 50_000_000,
      backupCount: 1,
    });
  });
});
