import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../middleware/auth.js", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));
vi.mock("../briefing/config-service.js", () => ({
  loadUserConfig: vi.fn(),
}));
vi.mock("../briefing/calendar.js", () => ({
  fetchCalendar: vi.fn(),
  pacificDayBoundaries: vi.fn((date) => ({
    dayStart: new Date(`${date.toISOString().slice(0, 10)}T08:00:00.000Z`),
    dayEnd: new Date(`${date.toISOString().slice(0, 10)}T07:59:59.999Z`),
  })),
  getCalendarSourceGroups: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  formatCalendarRouteError: vi.fn((err) => ({
    status: err.status || 500,
    body: { code: err.code || "unknown", message: err.message || "unknown" },
  })),
}));
vi.mock("../briefing/deadlines-read.js", () => ({
  readCalendarDeadlines: vi.fn(),
  readCalendarDeadlineRange: vi.fn(),
}));
vi.mock("../briefing/bills-service.js", () => ({
  billMirrorRefreshRange: vi.fn(() => ({ start: "2026-04-12", end: "2027-11-12" })),
  isBillsMirrorMaintenanceDue: vi.fn(),
  readBillsMirrorRange: vi.fn(),
  scheduleBillsMirrorRefresh: vi.fn(),
}));
vi.mock("../dashboard/current-service.js", () => ({
  requestBillsCurrentMaintenanceRefresh: vi.fn(),
}));
vi.mock("../briefing/google-places.js", () => ({
  suggestGooglePlaces: vi.fn(),
  getGooglePlaceDetails: vi.fn(),
}));
vi.mock("../briefing/reminder-service.js", () => ({
  recomputeUnsentRemindersForSource: vi.fn(),
  deleteSourceReminders: vi.fn(),
}));
vi.mock("../briefing/reminder-hydration.js", () => ({
  calendarEventAnchorAt: vi.fn(),
  hydrateCalendarEventsWithReminderState: vi.fn(async (_userId, events) => events),
}));

const { loadUserConfig } = await import("../briefing/config-service.js");
const { fetchCalendar } = await import("../briefing/calendar.js");
const { readCalendarDeadlineRange } = await import("../briefing/deadlines-read.js");
const { readBillsMirrorRange, scheduleBillsMirrorRefresh } = await import("../briefing/bills-service.js");
const calendarRoutes = (await import("./calendar.js")).default;

function makeApp() {
  const app = express();
  app.use("/api/calendar", calendarRoutes);
  return app;
}

describe("GET /api/calendar/search", () => {
  beforeEach(() => {
    process.env.EA_USER_ID = "test-user";
    loadUserConfig.mockResolvedValue({
      accounts: [
        { id: "gmail-main", type: "gmail", email: "me@example.com", calendar_enabled: 1 },
      ],
      settings: {},
    });
    fetchCalendar.mockResolvedValue([
      {
        id: "event-1",
        title: "Final presentation",
        startMs: Date.parse("2026-05-20T17:00:00.000Z"),
        endMs: Date.parse("2026-05-20T18:00:00.000Z"),
        time: "10:00 AM",
        duration: "1h",
        source: "School",
        sourceColor: "#4285f4",
        accountId: "gmail-main",
        calendarId: "primary",
        allDay: false,
      },
    ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: {
        ctm: {
          upcoming: [
            {
              id: "ctm-1",
              title: "Final project upload",
              due_date: "2026-05-19",
              source: "ctm",
              course_name: "CS 4220",
            },
          ],
        },
        todoist: { upcoming: [] },
      },
      errors: [],
    });
    readBillsMirrorRange.mockResolvedValue({
      schedules: [],
      recentTransactions: [],
      payeeMap: {},
      actualBudgetUrl: null,
      syncHealth: { state: "current", configured: true },
    });
    scheduleBillsMirrorRefresh.mockResolvedValue({ pendingRefreshAt: "2026-05-12T18:00:00.000Z" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns normalized Google event and deadline results for Events search", async () => {
    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=final");

    expect(res.status).toBe(200);
    expect(fetchCalendar).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "gmail-main" })],
      expect.objectContaining({ query: "final" }),
    );
    expect(readCalendarDeadlineRange).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({ start: expect.any(String), end: expect.any(String) }),
    );
    expect(res.body.results).toEqual([
      expect.objectContaining({
        type: "deadline",
        itemId: "ctm-1",
        itemDate: "2026-05-19",
        title: "Final project upload",
        sourceLabel: "Canvas",
        matchReason: "word_start",
        rankBucket: 1,
      }),
      expect.objectContaining({
        type: "event",
        itemId: "event-1",
        itemDate: "2026-05-20",
        title: "Final presentation",
        sourceLabel: "School",
        sourceColor: "#4285f4",
        matchReason: "word_start",
        rankBucket: 1,
      }),
    ]);
    expect(res.body.coverage.sources.map((source) => source.key)).toEqual([
      "google_calendar",
      "deadlines",
    ]);
    expect(res.body.truncated).toBe(false);
  });

  it("returns a cheap empty response for short queries without provider fanout", async () => {
    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=f");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      query: "f",
      scope: "events",
      results: [],
      resultCount: 0,
      totalMatches: 0,
      truncated: false,
      coverage: {
        scope: "events",
        reason: "query_too_short",
        sources: [],
      },
    });
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(readCalendarDeadlineRange).not.toHaveBeenCalled();
    expect(readBillsMirrorRange).not.toHaveBeenCalled();
  });

  it("rejects invalid scopes without provider fanout", async () => {
    const res = await request(makeApp()).get("/api/calendar/search?scope=all&q=final");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("calendar_search_scope_invalid");
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(readCalendarDeadlineRange).not.toHaveBeenCalled();
    expect(readBillsMirrorRange).not.toHaveBeenCalled();
  });

  it("searches only mirrored bill occurrences and reports mirror coverage", async () => {
    readBillsMirrorRange.mockResolvedValueOnce({
      schedules: [
        {
          id: "schedule-rent:2026-05-15",
          scheduleId: "schedule-rent",
          name: "Rent",
          payee: "Apartment",
          amount: 1900,
          next_date: "2026-05-15",
          paid: false,
        },
        {
          id: "schedule-internet:2026-05-18",
          scheduleId: "schedule-internet",
          name: "Internet",
          payee: "Rent-linked ISP",
          amount: 80,
          next_date: "2026-05-18",
          paid: false,
        },
      ],
      recentTransactions: [],
      payeeMap: {},
      actualBudgetUrl: "http://actual.local",
      syncHealth: { state: "needs_sync", configured: true },
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=bills&q=rent");

    expect(res.status).toBe(200);
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(readCalendarDeadlineRange).not.toHaveBeenCalled();
    expect(readBillsMirrorRange).toHaveBeenCalledWith("test-user", {
      start: "2026-04-12",
      end: "2027-11-12",
    });
    expect(res.body.results.map((result) => result.type)).toEqual(["bill", "bill"]);
    expect(res.body.results[0]).toMatchObject({
      itemId: "schedule-rent:2026-05-15",
      itemDate: "2026-05-15",
      title: "Rent",
      sourceLabel: "Bills",
      matchReason: "exact",
      rankBucket: 0,
      activation: {
        view: "bills",
        detailView: "bills",
        dateKey: "2026-05-15",
        itemId: "schedule-rent:2026-05-15",
        scheduleId: "schedule-rent",
      },
    });
    expect(res.body.coverage.sources).toEqual([
      expect.objectContaining({
        key: "bills_mirror",
        label: "Bills mirror",
        start: "2026-04-12",
        end: "2027-11-12",
        syncHealth: { state: "needs_sync", configured: true },
        actualBudgetUrl: "http://actual.local",
        strategy: "local_mirror",
      }),
    ]);
  });

  it("fetches Google event search from the today-centered window before broad backfill", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    fetchCalendar.mockResolvedValue([]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { ctm: { upcoming: [] }, todoist: { upcoming: [] } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=work");

    expect(res.status).toBe(200);
    expect(fetchCalendar).toHaveBeenCalled();
    expect(fetchCalendar.mock.calls[0][1]).toMatchObject({
      startDate: new Date("2026-05-12T08:00:00.000Z"),
      endDate: new Date("2026-11-12T07:59:59.999Z"),
      query: "work",
      limit: 50,
    });
    expect(fetchCalendar.mock.calls[1][1]).toMatchObject({
      startDate: new Date("2026-04-14T08:00:00.000Z"),
      endDate: new Date("2026-05-11T07:59:59.999Z"),
      query: "work",
      limit: 50,
    });
    expect(fetchCalendar.mock.calls[2][1]).toMatchObject({
      startDate: new Date("2026-02-12T08:00:00.000Z"),
      endDate: new Date("2026-04-13T07:59:59.999Z"),
      query: "work",
      limit: 50,
    });
    expect(res.body.coverage.sources[0]).toMatchObject({
      key: "google_calendar",
      start: "2025-05-12",
      end: "2027-11-12",
      prioritizedStart: "2026-02-12",
      prioritizedEnd: "2026-11-12",
    });
  });

  it("does not let frequent past matches exhaust the provider page before near-future matches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    fetchCalendar
      .mockResolvedValueOnce([
        {
          id: "work-today",
          title: "Work",
          startMs: Date.parse("2026-05-12T17:00:00.000Z"),
          endMs: Date.parse("2026-05-12T18:00:00.000Z"),
          source: "Work",
        },
        {
          id: "work-may-13",
          title: "Work",
          startMs: Date.parse("2026-05-13T17:00:00.000Z"),
          endMs: Date.parse("2026-05-13T18:00:00.000Z"),
          source: "Work",
        },
        {
          id: "work-may-14",
          title: "Work",
          startMs: Date.parse("2026-05-14T17:00:00.000Z"),
          endMs: Date.parse("2026-05-14T18:00:00.000Z"),
          source: "Work",
        },
        {
          id: "work-may-15",
          title: "Work",
          startMs: Date.parse("2026-05-15T17:00:00.000Z"),
          endMs: Date.parse("2026-05-15T18:00:00.000Z"),
          source: "Work",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "work-old",
          title: "Work",
          startMs: Date.parse("2026-02-12T17:00:00.000Z"),
          endMs: Date.parse("2026-02-12T18:00:00.000Z"),
          source: "Work",
        },
      ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { ctm: { upcoming: [] }, todoist: { upcoming: [] } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=work&limit=3");

    expect(res.status).toBe(200);
    expect(fetchCalendar).toHaveBeenCalledTimes(2);
    expect(res.body.results.map((result) => result.itemId)).toEqual([
      "work-today",
      "work-may-13",
      "work-may-14",
    ]);
    expect(res.body.totalMatches).toBe(5);
    expect(res.body.truncated).toBe(true);
  });

  it("fetches recent-past matches before older centered history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    fetchCalendar
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "work-apr-29",
          title: "Work",
          startMs: Date.parse("2026-04-29T17:00:00.000Z"),
          endMs: Date.parse("2026-04-29T18:00:00.000Z"),
          source: "Work",
        },
        {
          id: "work-may-04",
          title: "Work",
          startMs: Date.parse("2026-05-04T17:00:00.000Z"),
          endMs: Date.parse("2026-05-04T18:00:00.000Z"),
          source: "Work",
        },
        {
          id: "work-may-08",
          title: "Work",
          startMs: Date.parse("2026-05-08T17:00:00.000Z"),
          endMs: Date.parse("2026-05-08T18:00:00.000Z"),
          source: "Work",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "work-feb-12",
          title: "Work",
          startMs: Date.parse("2026-02-12T17:00:00.000Z"),
          endMs: Date.parse("2026-02-12T18:00:00.000Z"),
          source: "Work",
        },
      ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { ctm: { upcoming: [] }, todoist: { upcoming: [] } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=work&limit=3");

    expect(res.status).toBe(200);
    expect(fetchCalendar.mock.calls[1][1]).toMatchObject({
      startDate: new Date("2026-04-14T08:00:00.000Z"),
      endDate: new Date("2026-05-11T07:59:59.999Z"),
    });
    expect(res.body.results.map((result) => result.itemId)).toEqual([
      "work-apr-29",
      "work-may-04",
      "work-may-08",
    ]);
  });

  it("filters deterministic matches but returns a today-centered capped timeline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    const rankingEvents = [
      {
        id: "event-prefix-later",
        title: "Rent review",
        startMs: Date.parse("2026-05-20T17:00:00.000Z"),
        endMs: Date.parse("2026-05-20T18:00:00.000Z"),
        source: "Personal",
      },
      {
        id: "event-exact",
        title: "rent",
        startMs: Date.parse("2026-06-01T17:00:00.000Z"),
        endMs: Date.parse("2026-06-01T18:00:00.000Z"),
        source: "Personal",
      },
      {
        id: "event-field",
        title: "Budget sync",
        location: "Rent office",
        startMs: Date.parse("2026-05-18T17:00:00.000Z"),
        endMs: Date.parse("2026-05-18T18:00:00.000Z"),
        source: "Personal",
      },
      {
        id: "event-past",
        title: "Rent history",
        startMs: Date.parse("2026-05-01T17:00:00.000Z"),
        endMs: Date.parse("2026-05-01T18:00:00.000Z"),
        source: "Personal",
      },
      {
        id: "event-prefix-sooner",
        title: "Rent follow-up",
        startMs: Date.parse("2026-05-19T17:00:00.000Z"),
        endMs: Date.parse("2026-05-19T18:00:00.000Z"),
        source: "Personal",
      },
    ];
    fetchCalendar.mockResolvedValue(rankingEvents);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { ctm: { upcoming: [] }, todoist: { upcoming: [] } },
      errors: [],
    });

    const first = await request(makeApp()).get("/api/calendar/search?scope=events&q=rent&limit=3");
    const second = await request(makeApp()).get("/api/calendar/search?scope=events&q=rent&limit=3");

    expect(first.status).toBe(200);
    expect(first.body.results.map((result) => result.itemId)).toEqual([
      "event-field",
      "event-prefix-sooner",
      "event-prefix-later",
    ]);
    expect(first.body.results.map((result) => result.rankBucket)).toEqual([2, 1, 1]);
    expect(first.body.totalMatches).toBe(5);
    expect(first.body.resultCount).toBe(3);
    expect(first.body.truncated).toBe(true);
    expect(second.body.results.map((result) => result.itemId)).toEqual(
      first.body.results.map((result) => result.itemId),
    );
  });

  it("uses explicit event colors before calendar source colors in search results", async () => {
    fetchCalendar.mockResolvedValue([
      {
        id: "event-explicit-color",
        title: "Rent review",
        startMs: Date.parse("2026-05-20T17:00:00.000Z"),
        endMs: Date.parse("2026-05-20T18:00:00.000Z"),
        source: "Personal",
        sourceColor: "#4285f4",
        color: "#d50000",
      },
    ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { ctm: { upcoming: [] }, todoist: { upcoming: [] } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=rent");

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({
      itemId: "event-explicit-color",
      sourceLabel: "Personal",
      sourceColor: "#d50000",
    });
  });

  it("keeps match quality as metadata for chronological search results", async () => {
    const rankingEvents = [
      {
        id: "event-prefix-later",
        title: "Rent review",
        startMs: Date.parse("2026-05-20T17:00:00.000Z"),
        endMs: Date.parse("2026-05-20T18:00:00.000Z"),
        source: "Personal",
      },
      {
        id: "event-exact",
        title: "rent",
        startMs: Date.parse("2026-06-01T17:00:00.000Z"),
        endMs: Date.parse("2026-06-01T18:00:00.000Z"),
        source: "Personal",
      },
      {
        id: "event-prefix-sooner",
        title: "Rent follow-up",
        startMs: Date.parse("2026-05-19T17:00:00.000Z"),
        endMs: Date.parse("2026-05-19T18:00:00.000Z"),
        source: "Personal",
      },
    ];
    fetchCalendar.mockResolvedValue(rankingEvents);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { ctm: { upcoming: [] }, todoist: { upcoming: [] } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=rent");

    expect(res.status).toBe(200);
    expect(res.body.results.map((result) => result.itemId)).toEqual([
      "event-prefix-sooner",
      "event-prefix-later",
      "event-exact",
    ]);
    expect(res.body.results.map((result) => result.rankBucket)).toEqual([1, 1, 0]);
  });
});
