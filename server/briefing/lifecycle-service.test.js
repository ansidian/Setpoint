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
vi.mock("../db/dev-fixture.js", () => ({
  generateEnrichedMock: vi.fn(async () => ({ mock: true })),
  generateMockHistory: vi.fn(() => [{ id: 1, generated_at: "x", generation_time_ms: 0 }]),
}));
vi.mock("../db/scenarios/index.js", () => ({ applyScenarios: vi.fn() }));

const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  mockDb.execute.mockReset();
  process.env.NODE_ENV = originalEnv;
});

const { getLatest, getById, getStatus } = await import("./lifecycle-service.js");

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

  it("returns mock briefing when mock=true in dev", async () => {
    process.env.NODE_ENV = "development";
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const out = await getLatest("u1", { mock: true, scenarios: [] });

    expect(out.id).toBe(0);
    expect(out.briefing).toEqual({ mock: true });
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
