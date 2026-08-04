import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "../../test-utils/supertest.ts";
import { errorHandler } from "../../middleware/async-handler.ts";
import type { HttpError } from "../../snapshots/snapshot-types.ts";
import type { Client } from "@libsql/client";
import { createMigratedDb } from "../../snapshots/snapshot-test-fixtures.ts";
import { seedOwner, seedSession } from "../../test-utils/auth-db.ts";
import { createRequireCookieSession } from "../../middleware/auth.ts";
import { createSnapshotRouter } from "./snapshot.ts";

const snapshotService = {
  getSnapshotHistory: vi.fn(async () => ({
    snapshots: [{ id: 1, status: "active", readOnly: false }],
  })),
  getSnapshotViewById: vi.fn(async (_userId, id) => ({
    snapshot: { id, status: "frozen" },
    readOnly: true,
  })),
  getActiveSnapshotView: vi.fn(async () => ({
    snapshot: { id: 1, status: "active" },
    lanes: { needs_attention: [], fyi: [], noise: [] },
    carryover: [],
    laneCounts: { needs_attention: 0, fyi: 0, noise: 0, carryover: 0 },
    processing: { queued: 0, running: 0, total: 0, active: false },
    filters: { accounts: [], categories: [] },
  })),
  syncActiveSnapshot: vi.fn(async () => ({
    snapshot: { id: 1, status: "active" },
    processing: { queued: 2, running: 0, total: 2, active: true },
  })),
  moveSnapshotItemLane: vi.fn(async (_userId, itemId, lane) => {
    if (lane !== "fyi") {
      const error = new Error("Invalid snapshot lane") as HttpError;
      error.status = 400;
      throw error;
    }
    return { id: itemId, lane: "fyi" };
  }),
  dismissSnapshotItemForToday: vi.fn(async (_userId, itemId) => ({
    id: itemId,
    dismissed_from_today_at: "now",
  })),
  restoreSnapshotItemForToday: vi.fn(async (_userId, itemId) => ({
    id: itemId,
    dismissed_from_today_at: null,
  })),
  markSnapshotItemHandled: vi.fn(async (_userId, itemId) => ({ id: itemId, handled_at: "now" })),
  reopenSnapshotItem: vi.fn(async (_userId, itemId) => ({
    id: itemId,
    handled_at: null,
    lane: "needs_attention",
  })),
};

process.env.EA_USER_ID = "user-1";

let db: Client;

function makeApp({ authenticated = true }: { authenticated?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authenticated) req.headers.cookie = "ea_session=cookie-session";
    next();
  });
  app.use(cookieParser());
  app.use(
    "/api/briefing",
    createRequireCookieSession(db),
    createSnapshotRouter(snapshotService as never),
  );
  // Production parity (server/index.ts mounts a terminal errorHandler). A no-route
  // fall-through here returns a distinguishable JSON body instead of finalhandler's
  // text/html "Cannot POST", so any future 404 self-identifies its source via
  // res.body: {message:'Active handled snapshot item not found'} => the real service
  // ran (module mock not applied); {message:'No route ...'} => route never matched.
  app.use((req, res) => {
    res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` });
  });
  app.use(errorHandler);
  return app;
}

function authCookie() {
  return ["ea_session=cookie-session"];
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createMigratedDb();
  await seedOwner(db, { userId: "user-1", passwordHash: "hash" });
  await seedSession(db, "cookie-session");
});

afterEach(() => db.close());

describe("snapshot routes", () => {
  it("rejects snapshot requests without briefing cookie auth", async () => {
    const res = await request(makeApp({ authenticated: false })).get("/api/briefing/snapshot/active");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Not authenticated" });
  });

  it("returns snapshot history before snapshot id routes", async () => {
    const res = await request(makeApp())
      .get("/api/briefing/snapshot/history")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toEqual([{ id: 1, status: "active", readOnly: false }]);
  });

  it("returns snapshot detail by id", async () => {
    const res = await request(makeApp())
      .get("/api/briefing/snapshot/42")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ snapshot: { id: 42, status: "frozen" }, readOnly: true });
  });

  it("returns the active snapshot before greedy briefing id routes", async () => {
    const res = await request(makeApp())
      .get("/api/briefing/snapshot/active")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body.snapshot).toEqual({ id: 1, status: "active" });
  });

  it("syncs the active snapshot", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/snapshot/sync")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body.processing).toEqual({ queued: 2, running: 0, total: 2, active: true });
  });

  it("maps snapshot detail service errors to HTTP responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Snapshot not found") as HttpError;
    error.status = 404;
    vi.mocked(snapshotService.getSnapshotViewById).mockRejectedValueOnce(error);

    const res = await request(makeApp())
      .get("/api/briefing/snapshot/404")
      .set("Cookie", authCookie());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Snapshot not found" });
  });

  it("moves a snapshot item lane", async () => {
    const res = await request(makeApp())
      .patch("/api/briefing/snapshot/items/42/lane")
      .set("Cookie", authCookie())
      .send({ lane: "fyi" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, lane: "fyi" });
  });

  it("reports invalid snapshot item lane input as a bad request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(makeApp())
      .patch("/api/briefing/snapshot/items/42/lane")
      .set("Cookie", authCookie())
      .send({ lane: "later" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid snapshot lane" });
  });

  it("dismisses a snapshot item from today", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/snapshot/items/42/dismiss")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, dismissed_from_today_at: "now" });
  });

  it("restores a snapshot item dismissed from today", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/snapshot/items/42/restore")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, dismissed_from_today_at: null });
  });

  it("marks a snapshot item handled", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/snapshot/items/42/handled")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, handled_at: "now" });
  });

  it("reopens a handled snapshot item", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/snapshot/items/42/reopen")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, handled_at: null, lane: "needs_attention" });
  });
});
