import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("./index.js", () => ({
  generateBriefing: vi.fn(),
  quickRefresh: vi.fn(),
}));
vi.mock("./stored-briefing-service.js", () => ({
  mergeAccountPrefs: vi.fn((b) => b),
}));
const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  mockDb.execute.mockReset();
  process.env.NODE_ENV = originalEnv;
});

const briefingRuntime = await import("./index.js");
const {
  getLatest,
  getById,
  getStatus,
  getInProgress,
  refresh,
  triggerGeneration,
} = await import("./lifecycle-service.js");

describe("getLatest", () => {
  it("returns real briefing when row exists", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          id: 5,
          status: "ready",
          briefing_json: JSON.stringify({ hello: "world" }),
          generated_at: "2026-04-18",
          generation_time_ms: 100,
        },
      ],
    });

    const out = await getLatest("u1", {});

    expect(out).toMatchObject({ id: 5, status: "ready", generated_at: "2026-04-18" });
    expect(out.briefing).toEqual({ hello: "world" });
  });

  it("returns { briefing: null } when no row in development", async () => {
    process.env.NODE_ENV = "development";
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const out = await getLatest("u1");

    expect(out).toEqual({ briefing: null });
  });

  it("returns { briefing: null } when no row in production", async () => {
    process.env.NODE_ENV = "production";
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const out = await getLatest("u1", {});

    expect(out).toEqual({ briefing: null });
  });
});

describe("getById", () => {
  it("throws 404 when row missing in production", async () => {
    process.env.NODE_ENV = "production";
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    await expect(getById("u1", "999")).rejects.toMatchObject({ status: 404 });
  });
});

describe("getStatus", () => {
  it("returns row", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ id: 1, status: "ready", error_message: null, generation_time_ms: 50, progress: 100 }],
    });
    const out = await getStatus("u1", "1");
    expect(out.status).toBe("ready");
  });

  it("throws 404 when not found", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] });
    await expect(getStatus("u1", "99")).rejects.toMatchObject({ status: 404 });
  });
});

describe("legacy runtime quarantine", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  it("blocks production batch generation before generateBriefing can write ea_briefings", async () => {
    await expect(triggerGeneration("u1")).rejects.toMatchObject({
      status: 410,
      message: "Legacy briefing generation is retired",
    });

    expect(briefingRuntime.generateBriefing).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("blocks production quick refresh before quickRefresh can mutate ea_briefings", async () => {
    await expect(refresh("u1")).rejects.toMatchObject({
      status: 410,
      message: "Legacy briefing refresh is retired",
    });

    expect(briefingRuntime.quickRefresh).not.toHaveBeenCalled();
  });

  it("does not inspect legacy in-progress rows in production", async () => {
    const out = await getInProgress("u1");

    expect(out).toEqual({ generating: false, retired: true });
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("blocks production generation status polling", async () => {
    await expect(getStatus("u1", "1")).rejects.toMatchObject({
      status: 410,
      message: "Legacy briefing status polling is retired",
    });

    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});
