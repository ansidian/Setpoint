import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import request from "supertest";

const mockDb = { execute: vi.fn() };

vi.mock("../../db/connection.js", () => ({ default: mockDb }));
vi.mock("../../snapshots/snapshot-service.js", () => ({
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
      const error = new Error("Invalid snapshot lane");
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
}));

process.env.EA_USER_ID = "user-1";

const snapshotService = await import("../../snapshots/snapshot-service.js");
const briefingRoutes = (await import("./index.js")).default;
const cookieSessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", briefingRoutes);
  return app;
}

function authCookie() {
  return ["ea_session=cookie-session"];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockImplementation(async ({ sql, args }) => {
    if (sql.includes("FROM ea_sessions")) {
      return args[0] === cookieSessionHash
        ? { rows: [{ expires_at: Date.now() + 60_000 }] }
        : { rows: [] };
    }
    return { rows: [] };
  });
});

describe("snapshot routes", () => {
  it("rejects snapshot requests without briefing cookie auth", async () => {
    const res = await request(makeApp()).get("/api/briefing/snapshot/active");

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
    const error = new Error("Snapshot not found");
    error.status = 404;
    snapshotService.getSnapshotViewById.mockRejectedValueOnce(error);

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
