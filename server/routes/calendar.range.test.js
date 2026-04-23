import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock deps before importing the route
vi.mock("../middleware/auth.js", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));
vi.mock("../briefing/index.js", () => ({
  loadUserConfig: vi.fn(),
  separateDeadlines: vi.fn(),
  computeDeadlineStats: vi.fn(),
  loadCompletedTaskIds: vi.fn(),
  carryForwardCompletedTodoist: vi.fn(),
}));
vi.mock("../briefing/calendar.js", () => ({
  fetchCalendar: vi.fn(),
  pacificDayBoundaries: vi.fn((date) => ({ dayStart: date, dayEnd: date })),
}));
vi.mock("../briefing/ctm.js", () => ({ fetchCTMDeadlinesAll: vi.fn() }));
vi.mock("../briefing/todoist.js", () => ({ fetchTodoistTasksAll: vi.fn() }));
vi.mock("../briefing/tombstones.js", () => ({
  hydrateRecurringTombstones: vi.fn(),
  addDaysIso: vi.fn(),
}));
vi.mock("../db/connection.js", () => ({ default: { execute: vi.fn() } }));

const { loadUserConfig } = await import("../briefing/index.js");
const { fetchCalendar } = await import("../briefing/calendar.js");
const calendarRoutes = (await import("./calendar.js")).default;

function makeApp() {
  const app = express();
  app.use("/api/calendar", calendarRoutes);
  return app;
}

describe("GET /api/calendar/range", () => {
  beforeEach(() => {
    loadUserConfig.mockResolvedValue({
      accounts: [
        { id: "a1", type: "gmail", email: "x@y.com", calendar_enabled: 1 },
      ],
      settings: {},
    });
    fetchCalendar.mockResolvedValue([
      { title: "Test event", startMs: 1, endMs: 2, source: "x@y.com", color: "#abc" },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when start param missing", async () => {
    const res = await request(makeApp()).get("/api/calendar/range?end=2026-04-25");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/start/i);
  });

  it("returns 400 when end param missing", async () => {
    const res = await request(makeApp()).get("/api/calendar/range?start=2026-04-18");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/end/i);
  });

  it("returns 400 on malformed date", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/range?start=not-a-date&end=2026-04-25",
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when end < start", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/range?start=2026-04-25&end=2026-04-18",
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when span > 62 days", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/range?start=2026-01-01&end=2026-12-31",
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/62/);
  });

  it("returns events on happy path", async () => {
    const res = await request(makeApp()).get(
      "/api/calendar/range?start=2026-04-18&end=2026-04-25",
    );
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.fetchedAt).toEqual(expect.any(String));
  });

  it("filters to calendar-enabled Gmail accounts", async () => {
    loadUserConfig.mockResolvedValueOnce({
      accounts: [
        { id: "a1", type: "gmail", email: "on@y.com", calendar_enabled: 1 },
        { id: "a2", type: "gmail", email: "off@y.com", calendar_enabled: 0 },
        { id: "a3", type: "icloud", email: "i@y.com" },
      ],
      settings: {},
    });
    await request(makeApp()).get(
      "/api/calendar/range?start=2026-04-18&end=2026-04-25",
    );
    const passed = fetchCalendar.mock.calls[0][0];
    expect(passed).toHaveLength(1);
    expect(passed[0].email).toBe("on@y.com");
  });
});
