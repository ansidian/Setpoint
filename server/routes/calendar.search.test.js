import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../middleware/auth.ts", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));
vi.mock("../platform/config-service.ts", () => ({
  loadUserConfig: vi.fn(),
}));
vi.mock("../calendar/calendar.js", async () => {
  const rangeModel = await import("../calendar/calendar-range-model.js");
  const searchService = await import("../calendar/calendar-search-service.js");
  return {
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
    validateCalendarRange: rangeModel.validateCalendarRange,
    isCalendarSearchInputError: searchService.isCalendarSearchInputError,
    searchCalendar: searchService.searchCalendar,
  };
});
vi.mock("../calendar/calendar-search-mirror.js", async (importActual) => ({
  // Keep the real pure helpers (addMonthsIso powers calendarSearchRange in the route);
  // only the DB-touching functions are stubbed below.
  ...(await importActual()),
  deleteCalendarSearchMirrorOccurrence: vi.fn(),
  getCalendarSearchMirrorHealth: vi.fn(),
  listCalendarSearchMirrorOccurrences: vi.fn(),
  markCalendarSearchMirrorDirty: vi.fn(),
  requestCalendarSearchMirrorSync: vi.fn(),
  upsertCalendarSearchMirrorOccurrence: vi.fn(),
}));
vi.mock("../tasks/deadlines-read.ts", () => ({
  readCalendarDeadlines: vi.fn(),
  readCalendarDeadlineRange: vi.fn(),
}));
vi.mock("../bills/bills-service.ts", () => ({
  billMirrorRefreshRange: vi.fn(() => ({ start: "2026-04-12", end: "2027-11-12" })),
  isBillsMirrorMaintenanceDue: vi.fn(),
  readBillsMirrorRange: vi.fn(),
  scheduleBillsMirrorRefresh: vi.fn(),
  shouldScheduleImmediateBillsRefresh: (health, now) => {
    if (health?.state !== "needs_sync") return false;
    const pendingAt = health?.pendingRefreshAt ? new Date(health.pendingRefreshAt).getTime() : null;
    return pendingAt === null || pendingAt <= new Date(now ?? Date.now()).getTime();
  },
}));
vi.mock("../dashboard/current-service.js", () => ({
  applyDeadlineCurrentStatus: vi.fn(),
  requestBillsCurrentMaintenanceRefresh: vi.fn(),
}));
vi.mock("../tasks/tasks-service.ts", () => ({
  completeDeadlineOccurrence: vi.fn(),
  createDeadline: vi.fn(),
  deleteDeadline: vi.fn(),
  updateDeadline: vi.fn(),
}));
vi.mock("../platform/google-places.ts", () => ({
  suggestGooglePlaces: vi.fn(),
  getGooglePlaceDetails: vi.fn(),
}));
vi.mock("../reminders/reminder-service.ts", () => ({
  recomputeUnsentRemindersForSource: vi.fn(),
  deleteSourceReminders: vi.fn(),
}));
vi.mock("../reminders/reminder-hydration.ts", () => ({
  calendarEventAnchorAt: vi.fn(),
  hydrateCalendarEventsWithReminderState: vi.fn(async (_userId, events) => events),
}));

const { loadUserConfig } = await import("../platform/config-service.ts");
const { fetchCalendar } = await import("../calendar/calendar.js");
const calendarSearchMirror = await import("../calendar/calendar-search-mirror.js");
const { readCalendarDeadlineRange } = await import("../tasks/deadlines-read.ts");
const { readBillsMirrorRange, scheduleBillsMirrorRefresh } = await import("../bills/bills-service.ts");
const calendarRoutes = (await import("./calendar.js")).default;

function makeApp() {
  const app = express();
  app.use("/api/calendar", calendarRoutes);
  return app;
}

function event(overrides = {}) {
  return {
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
    ...overrides,
  };
}

const currentMirrorHealth = {
  state: "current",
  configured: true,
  severity: "none",
  sources: [
    {
      accountId: "gmail-main",
      calendarId: "primary",
      calendarLabel: "School",
      state: "current",
      severity: "none",
      windowStart: "2025-05-12",
      windowEnd: "2027-11-12",
      lastSuccessAt: "2026-05-12T18:00:00.000Z",
    },
  ],
};

describe("GET /api/calendar/search", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-12T19:00:00.000Z"));
    process.env.EA_USER_ID = "test-user";
    loadUserConfig.mockResolvedValue({
      accounts: [
        { id: "gmail-main", type: "gmail", email: "me@example.com", calendar_enabled: 1 },
      ],
      settings: {},
    });
    calendarSearchMirror.listCalendarSearchMirrorOccurrences.mockResolvedValue([event()]);
    calendarSearchMirror.getCalendarSearchMirrorHealth.mockResolvedValue(currentMirrorHealth);
    calendarSearchMirror.requestCalendarSearchMirrorSync.mockReturnValue({ queued: true });
    readCalendarDeadlineRange.mockResolvedValue({
      payload: {
        upcoming: [
          {
            id: "deadline-1",
            title: "Final project upload",
            due_date: "2026-05-19",
            course_name: "CS 4220",
          },
        ],
        stats: { total: 1 },
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

  it("returns mirror-backed Google event and deadline results for Events search without provider search", async () => {
    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=final");

    expect(res.status).toBe(200);
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(calendarSearchMirror.listCalendarSearchMirrorOccurrences).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({
        start: "2025-05-12",
        end: "2027-11-12",
        query: "final",
        limit: 1000,
        centerDate: "2026-05-12",
      }),
    );
    expect(readCalendarDeadlineRange).toHaveBeenCalledWith(
      "test-user",
      { start: "2025-05-12", end: "2027-11-12" },
    );
    expect(res.body.results).toEqual([
      expect.objectContaining({
        type: "deadline",
        id: "deadline:deadline-1:2026-05-19",
        itemId: "deadline:deadline-1:2026-05-19",
        itemDate: "2026-05-19",
        title: "Final project upload",
        sourceLabel: "Deadline",
        sourceColor: "#e44332",
        matchReason: "word_start",
        rankBucket: 1,
        activation: expect.objectContaining({
          view: "events",
          detailKind: "deadline",
          dateKey: "2026-05-19",
          itemId: "deadline:deadline-1:2026-05-19",
        }),
        payload: expect.objectContaining({
          id: "deadline-1",
          dueDate: "2026-05-19",
        }),
      }),
      expect.objectContaining({
        type: "event",
        itemId: "event-1",
        itemDate: "2026-05-20",
        title: "Final presentation",
        sourceLabel: "School",
        sourceColor: "#4285f4",
        activation: expect.objectContaining({
          view: "events",
          detailView: "events",
          accountId: "gmail-main",
          calendarId: "primary",
        }),
      }),
    ]);
    expect(res.body.coverage.sources).toEqual([
      expect.objectContaining({
        key: "google_calendar",
        label: "Google Calendar",
        searched: true,
        start: "2025-05-12",
        end: "2027-11-12",
        strategy: "local_mirror",
        syncHealth: expect.objectContaining({ state: "current" }),
      }),
      expect.objectContaining({
        key: "deadlines",
        label: "Deadline overlays",
        searched: true,
        start: "2025-05-12",
        end: "2027-11-12",
      }),
    ]);
    expect(calendarSearchMirror.requestCalendarSearchMirrorSync).not.toHaveBeenCalled();
  });

  it("returns completed deadline-history occurrences with domain identity and labels", async () => {
    readCalendarDeadlineRange.mockResolvedValueOnce({
      payload: {
        upcoming: [
          {
            id: "td-rec",
            title: "Final recurring upload",
            due_date: "2026-05-10",
            status: "complete",
            project_name: "School",
            _tombstone: true,
          },
        ],
        stats: { total: 1 },
      },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=final");

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({
        type: "deadline",
        id: "deadline:td-rec:2026-05-10",
        itemId: "deadline:td-rec:2026-05-10",
        itemDate: "2026-05-10",
        title: "Final recurring upload",
        subtitle: "School · complete",
        meta: "Deadline",
        sourceLabel: "Deadline",
        activation: expect.objectContaining({
          view: "events",
          detailKind: "deadline",
          dateKey: "2026-05-10",
          itemId: "deadline:td-rec:2026-05-10",
        }),
        payload: expect.objectContaining({
          id: "td-rec",
          dueDate: "2026-05-10",
          status: "complete",
        }),
      }),
      expect.objectContaining({
        type: "event",
        itemId: "event-1",
      }),
    ]);
    expect(res.body.results[0].sourceLabel).toBe("Deadline");
  });

  it("returns deadline results and requests non-blocking repair when the event mirror is initializing", async () => {
    calendarSearchMirror.listCalendarSearchMirrorOccurrences.mockResolvedValueOnce([]);
    calendarSearchMirror.getCalendarSearchMirrorHealth.mockResolvedValueOnce({
      state: "initializing",
      configured: true,
      severity: "info",
      sources: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=final");

    expect(res.status).toBe(200);
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(res.body.results).toEqual([
      expect.objectContaining({
        type: "deadline",
        itemId: "deadline:deadline-1:2026-05-19",
      }),
    ]);
    expect(res.body.coverage.sources[0]).toMatchObject({
      key: "google_calendar",
      searched: false,
      syncHealth: { state: "initializing", configured: true, severity: "info", sources: [] },
      strategy: "local_mirror",
    });
    expect(calendarSearchMirror.requestCalendarSearchMirrorSync).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({ reason: "calendar-search-initializing", forceFull: true }),
    );
  });

  it("reports stale mirror coverage while returning usable last-known event rows", async () => {
    calendarSearchMirror.getCalendarSearchMirrorHealth.mockResolvedValueOnce({
      ...currentMirrorHealth,
      state: "stale",
      severity: "warning",
      sources: [
        {
          ...currentMirrorHealth.sources[0],
          state: "stale",
          severity: "warning",
          ageMs: 25 * 60 * 60 * 1000,
        },
      ],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=final");

    expect(res.status).toBe(200);
    expect(res.body.results.some((result) => result.type === "event")).toBe(true);
    expect(res.body.coverage.sources[0]).toMatchObject({
      key: "google_calendar",
      searched: true,
      syncHealth: expect.objectContaining({
        state: "stale",
        severity: "warning",
      }),
    });
    expect(calendarSearchMirror.requestCalendarSearchMirrorSync).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({ reason: "calendar-search-stale", forceFull: false }),
    );
  });

  it("returns a cheap empty response for short queries without provider or mirror fanout", async () => {
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
    expect(calendarSearchMirror.listCalendarSearchMirrorOccurrences).not.toHaveBeenCalled();
    expect(readCalendarDeadlineRange).not.toHaveBeenCalled();
    expect(readBillsMirrorRange).not.toHaveBeenCalled();
  });

  it("rejects invalid scopes without provider fanout", async () => {
    const res = await request(makeApp()).get("/api/calendar/search?scope=all&q=final");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("calendar_search_scope_invalid");
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(calendarSearchMirror.listCalendarSearchMirrorOccurrences).not.toHaveBeenCalled();
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
    expect(calendarSearchMirror.listCalendarSearchMirrorOccurrences).not.toHaveBeenCalled();
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

  it("keeps Calendar Search Ranking and chronological result shape stable with mirror rows", async () => {
    calendarSearchMirror.listCalendarSearchMirrorOccurrences.mockResolvedValue([
      event({
        id: "event-prefix-later",
        title: "Rent review",
        startMs: Date.parse("2026-05-20T17:00:00.000Z"),
      }),
      event({
        id: "event-exact",
        title: "rent",
        startMs: Date.parse("2026-06-01T17:00:00.000Z"),
      }),
      event({
        id: "event-field",
        title: "Budget sync",
        location: "Rent office",
        startMs: Date.parse("2026-05-18T17:00:00.000Z"),
      }),
      event({
        id: "event-past",
        title: "Rent history",
        startMs: Date.parse("2026-05-01T17:00:00.000Z"),
      }),
      event({
        id: "event-prefix-sooner",
        title: "Rent follow-up",
        startMs: Date.parse("2026-05-19T17:00:00.000Z"),
      }),
    ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { upcoming: [], stats: { total: 0 } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=rent&limit=3");

    expect(res.status).toBe(200);
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(res.body.results.map((result) => result.itemId)).toEqual([
      "event-field",
      "event-prefix-sooner",
      "event-prefix-later",
    ]);
    expect(res.body.results.map((result) => result.rankBucket)).toEqual([2, 1, 1]);
    expect(res.body.totalMatches).toBe(5);
    expect(res.body.resultCount).toBe(3);
    expect(res.body.truncated).toBe(true);
  });

  it("does not let old mirror rows consume the candidate limit before near-today matches are ranked", async () => {
    const oldWorkEvents = Array.from({ length: 6 }, (_, index) => event({
      id: `work-old-${index}`,
      title: "Work",
      startMs: Date.parse(`2025-07-${String(25 + index).padStart(2, "0")}T17:00:00.000Z`),
    }));
    const centeredWorkEvents = [
      event({ id: "work-today", title: "Work", startMs: Date.parse("2026-05-12T17:00:00.000Z") }),
      event({ id: "work-tomorrow", title: "Work", startMs: Date.parse("2026-05-13T17:00:00.000Z") }),
      event({ id: "work-yesterday", title: "Work", startMs: Date.parse("2026-05-11T17:00:00.000Z") }),
    ];
    const ascendingMirrorRows = [...oldWorkEvents, ...centeredWorkEvents];
    calendarSearchMirror.listCalendarSearchMirrorOccurrences.mockImplementationOnce(
      async (_userId, { limit }) => ascendingMirrorRows.slice(0, limit),
    );
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { upcoming: [], stats: { total: 0 } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=work&limit=3");

    expect(res.status).toBe(200);
    expect(calendarSearchMirror.listCalendarSearchMirrorOccurrences).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({
        query: "work",
        limit: expect.any(Number),
      }),
    );
    expect(calendarSearchMirror.listCalendarSearchMirrorOccurrences.mock.calls.at(-1)[1].limit).toBeGreaterThan(3);
    expect(res.body.results.map((result) => result.itemId)).toEqual([
      "work-yesterday",
      "work-today",
      "work-tomorrow",
    ]);
  });

  it("dedupes mirrored event doubles before applying the visible result limit", async () => {
    calendarSearchMirror.listCalendarSearchMirrorOccurrences.mockResolvedValue([
      event({
        id: "work-google-expanded",
        title: "Work",
        location: "Back office",
        startMs: Date.parse("2026-05-12T17:00:00.000Z"),
        endMs: Date.parse("2026-05-12T20:45:00.000Z"),
        originalStartTime: "2026-05-12T10:00:00-07:00",
      }),
      event({
        id: "work-google-single",
        title: "Work",
        startMs: Date.parse("2026-05-12T17:00:00.000Z"),
        endMs: Date.parse("2026-05-12T20:45:00.000Z"),
        originalStartTime: "1778584500000",
      }),
      event({
        id: "work-next-day",
        title: "Work",
        startMs: Date.parse("2026-05-13T17:00:00.000Z"),
        endMs: Date.parse("2026-05-13T20:45:00.000Z"),
      }),
    ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { upcoming: [], stats: { total: 0 } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=work&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.results.map((result) => result.itemId)).toEqual([
      "work-google-expanded",
      "work-next-day",
    ]);
    expect(res.body.resultCount).toBe(2);
    expect(res.body.totalMatches).toBe(2);
    expect(res.body.truncated).toBe(false);
  });

  it("dedupes overlapping same-day mirrored event doubles even when their end times differ", async () => {
    calendarSearchMirror.listCalendarSearchMirrorOccurrences.mockResolvedValue([
      event({
        id: "work-short",
        title: "Work",
        startMs: Date.parse("2026-05-12T17:45:00.000Z"),
        endMs: Date.parse("2026-05-12T21:45:00.000Z"),
      }),
      event({
        id: "work-edited-series",
        title: "Work",
        startMs: Date.parse("2026-05-12T18:15:00.000Z"),
        endMs: Date.parse("2026-05-12T22:00:00.000Z"),
      }),
      event({
        id: "work-next-day",
        title: "Work",
        startMs: Date.parse("2026-05-13T17:00:00.000Z"),
        endMs: Date.parse("2026-05-13T20:45:00.000Z"),
      }),
    ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { upcoming: [], stats: { total: 0 } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=work&limit=3");

    expect(res.status).toBe(200);
    expect(res.body.results.map((result) => result.itemId)).toEqual([
      "work-short",
      "work-next-day",
    ]);
    expect(res.body.totalMatches).toBe(2);
    expect(res.body.truncated).toBe(false);
  });

  it("does not match Google events by calendar source label alone", async () => {
    calendarSearchMirror.listCalendarSearchMirrorOccurrences.mockResolvedValue([
      event({
        id: "source-only",
        title: "asdasd",
        source: "Work",
        location: "",
        description: "",
        startMs: Date.parse("2026-05-12T17:00:00.000Z"),
      }),
      event({
        id: "title-match",
        title: "Work",
        source: "Personal",
        startMs: Date.parse("2026-05-13T17:00:00.000Z"),
      }),
    ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { upcoming: [], stats: { total: 0 } },
      errors: [],
    });

    const res = await request(makeApp()).get("/api/calendar/search?scope=events&q=work&limit=5");

    expect(res.status).toBe(200);
    expect(res.body.results.map((result) => result.itemId)).toEqual(["title-match"]);
  });

  it("uses explicit event colors before calendar source colors in search results", async () => {
    calendarSearchMirror.listCalendarSearchMirrorOccurrences.mockResolvedValueOnce([
      event({
        id: "event-explicit-color",
        title: "Rent review",
        source: "Personal",
        sourceColor: "#4285f4",
        color: "#d50000",
      }),
    ]);
    readCalendarDeadlineRange.mockResolvedValue({
      payload: { upcoming: [], stats: { total: 0 } },
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
});
