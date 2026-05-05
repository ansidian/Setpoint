import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import request from "supertest";

const mockDb = { execute: vi.fn() };

vi.mock("../../db/connection.js", () => ({ default: mockDb }));
vi.mock("../../briefing/snapshot-service.js", () => ({
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
	  moveSnapshotItemLane: vi.fn(async () => ({ id: 42, lane: "fyi" })),
  dismissSnapshotItemForToday: vi.fn(async () => ({ id: 42, dismissed_from_today_at: "now" })),
  markSnapshotItemHandled: vi.fn(async () => ({ id: 42, handled_at: "now" })),
}));

process.env.EA_USER_ID = "user-1";

const snapshotService = await import("../../briefing/snapshot-service.js");
const briefingRoutes = (await import("./index.js")).default;
const cookieSessionHash = `sha256:${crypto.createHash("sha256").update("cookie-session").digest("hex")}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/briefing", briefingRoutes);
  return app;
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
  it("returns snapshot history through briefing cookie auth before snapshot id routes", async () => {
    const res = await request(makeApp())
      .get("/api/briefing/snapshot/history")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toEqual([{ id: 1, status: "active", readOnly: false }]);
    expect(snapshotService.getSnapshotHistory).toHaveBeenCalledWith("user-1");
  });

  it("returns snapshot detail by id through briefing cookie auth", async () => {
    const res = await request(makeApp())
      .get("/api/briefing/snapshot/42")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ snapshot: { id: 42, status: "frozen" }, readOnly: true });
    expect(snapshotService.getSnapshotViewById).toHaveBeenCalledWith("user-1", 42);
  });

  it("returns the active snapshot through briefing cookie auth before greedy briefing id routes", async () => {
    const res = await request(makeApp())
      .get("/api/briefing/snapshot/active")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body.snapshot).toEqual({ id: 1, status: "active" });
    expect(snapshotService.getActiveSnapshotView).toHaveBeenCalledWith("user-1");
	  });

	  it("syncs the active snapshot through briefing cookie auth", async () => {
	    const res = await request(makeApp())
	      .post("/api/briefing/snapshot/sync")
	      .set("Cookie", ["ea_session=cookie-session"]);

	    expect(res.status).toBe(200);
	    expect(res.body.processing).toEqual({ queued: 2, running: 0, total: 2, active: true });
	    expect(snapshotService.syncActiveSnapshot).toHaveBeenCalledWith("user-1");
	  });

	  it("moves a snapshot item lane", async () => {
    const res = await request(makeApp())
      .patch("/api/briefing/snapshot/items/42/lane")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ lane: "fyi" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, lane: "fyi" });
    expect(snapshotService.moveSnapshotItemLane).toHaveBeenCalledWith("user-1", 42, "fyi");
  });

  it("dismisses a snapshot item from today", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/snapshot/items/42/dismiss")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, dismissed_from_today_at: "now" });
    expect(snapshotService.dismissSnapshotItemForToday).toHaveBeenCalledWith("user-1", 42);
  });

  it("marks a snapshot item handled", async () => {
    const res = await request(makeApp())
      .post("/api/briefing/snapshot/items/42/handled")
      .set("Cookie", ["ea_session=cookie-session"]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, handled_at: "now" });
    expect(snapshotService.markSnapshotItemHandled).toHaveBeenCalledWith("user-1", 42);
  });
});
