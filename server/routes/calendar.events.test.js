import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../middleware/auth.js", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));
vi.mock("../platform/config-service.js", () => ({
  loadUserConfig: vi.fn(),
}));
vi.mock("../tasks/deadline-helpers.js", () => ({
  computeDeadlineStats: vi.fn(),
  loadCompletedTaskIds: vi.fn(),
}));
vi.mock("../calendar/calendar.js", () => ({
  fetchCalendar: vi.fn(),
  pacificDayBoundaries: vi.fn((date) => ({ dayStart: date, dayEnd: date })),
  getCalendarSourceGroups: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  formatCalendarRouteError: vi.fn((err) => ({
    status: err.status || 500,
    body: { code: err.code || "unknown", message: err.message || "unknown" },
  })),
}));
vi.mock("../calendar/calendar-search-mirror.js", async (importActual) => ({
  // Keep the real pure helpers (addMonthsIso powers the route's range helpers);
  // only the DB-touching functions are stubbed below.
  ...(await importActual()),
  deleteCalendarSearchMirrorOccurrence: vi.fn().mockResolvedValue({ deleted: true }),
  getCalendarSearchMirrorHealth: vi.fn(),
  listCalendarSearchMirrorOccurrences: vi.fn(),
  markCalendarSearchMirrorDirty: vi.fn().mockResolvedValue({ marked: true }),
  requestCalendarSearchMirrorSync: vi.fn(),
  upsertCalendarSearchMirrorOccurrence: vi.fn().mockResolvedValue({ upserted: true }),
}));
vi.mock("../calendar/calendar-search.js", () => ({
  deadlineSearchCandidates: vi.fn(() => []),
  normalizeBillSearchCandidate: vi.fn((bill) => bill),
  normalizeEventSearchCandidate: vi.fn((event) => event),
  normalizeLimit: vi.fn(() => 20),
  rankCalendarSearchCandidates: vi.fn(() => ({ results: [], totalMatches: 0, truncated: false })),
}));
vi.mock("../tasks/deadlines-read.js", () => ({
  readCalendarDeadlines: vi.fn(),
  readCalendarDeadlineRange: vi.fn(),
}));
vi.mock("../tasks/tasks-service.js", () => ({
  completeDeadlineOccurrence: vi.fn(),
  createDeadline: vi.fn(),
  deleteDeadline: vi.fn(),
  updateDeadline: vi.fn(),
}));
vi.mock("../bills/bills-service.js", () => ({
  billMirrorRefreshRange: vi.fn(() => ({ start: "2026-05-01", end: "2026-05-31" })),
  isBillsMirrorMaintenanceDue: vi.fn(),
  readBillsMirrorRange: vi.fn(),
  scheduleBillsMirrorRefresh: vi.fn(),
}));
vi.mock("../dashboard/current-service.js", () => ({
  applyDeadlineCurrentStatus: vi.fn(),
  requestBillsCurrentMaintenanceRefresh: vi.fn(),
}));
vi.mock("../platform/google-places.js", () => ({
  suggestGooglePlaces: vi.fn(),
  getGooglePlaceDetails: vi.fn(),
}));
vi.mock("../tasks/todoist.js", () => ({
  fetchTodoistDueTaskIdSet: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  fetchTodoistTasksAll: vi.fn(),
  fetchTodoistTasksRange: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
}));
vi.mock("../tasks/tombstones.js", () => ({
  hydrateRecurringTombstones: vi.fn(),
  addDaysIso: vi.fn(),
}));
vi.mock("../reminders/reminder-service.js", () => ({
  recomputeUnsentRemindersForSource: vi.fn(),
  deleteSourceReminders: vi.fn(),
  listUpcomingReminderStatesForSources: vi.fn().mockResolvedValue(new Map()),
  reminderSourceKey: ({ sourceType, sourceItemId, sourceOccurrenceId = null }) => `${sourceType}:${sourceItemId}:${sourceOccurrenceId || ""}`,
}));
vi.mock("../db/connection.js", () => ({ default: { execute: vi.fn() } }));

const { loadUserConfig } = await import("../platform/config-service.js");
const {
  getCalendarSourceGroups,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} = await import("../calendar/calendar.js");
const calendarSearchMirror = await import("../calendar/calendar-search-mirror.js");
const {
  suggestGooglePlaces,
  getGooglePlaceDetails,
} = await import("../platform/google-places.js");
const reminderService = await import("../reminders/reminder-service.js");
const calendarRoutes = (await import("./calendar.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/calendar", calendarRoutes);
  return app;
}

describe("calendar event routes", () => {
  beforeEach(() => {
    process.env.EA_USER_ID = "test-user";
    loadUserConfig.mockResolvedValue({
      accounts: [
        {
          id: "gmail-main",
          type: "gmail",
          email: "me@example.com",
          label: "Google",
          calendar_enabled: 1,
        },
      ],
      settings: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns grouped calendar sources", async () => {
    getCalendarSourceGroups.mockResolvedValue([
      {
        accountId: "gmail-main",
        accountLabel: "Google",
        accountEmail: "me@example.com",
        calendars: [
          { id: "primary", summary: "Personal", writable: true, accessRole: "owner" },
        ],
      },
    ]);

    const res = await request(makeApp()).get("/api/calendar/calendars");

    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(getCalendarSourceGroups).toHaveBeenCalledWith([
      expect.objectContaining({ id: "gmail-main" }),
    ]);
  });

  it("creates a calendar event on the selected account", async () => {
    createCalendarEvent.mockResolvedValue({
      id: "event-1",
      title: "Planning",
      accountId: "gmail-main",
      calendarId: "primary",
    });

    const res = await request(makeApp())
      .post("/api/calendar/events")
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Planning",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "09:00",
        endTime: "09:30",
        colorId: "7",
      });

    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      id: "event-1",
      title: "Planning",
      accountId: "gmail-main",
      calendarId: "primary",
    });
    expect(createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-main" }),
      expect.objectContaining({ title: "Planning", calendarId: "primary", colorId: "7" }),
    );
    expect(calendarSearchMirror.upsertCalendarSearchMirrorOccurrence).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({ id: "event-1", accountId: "gmail-main", calendarId: "primary" }),
    );
    expect(calendarSearchMirror.markCalendarSearchMirrorDirty).not.toHaveBeenCalled();
  });

  it("returns a typed 404 when creating against an unavailable calendar account", async () => {
    const res = await request(makeApp())
      .post("/api/calendar/events")
      .send({
        accountId: "gmail-missing",
        calendarId: "primary",
        title: "Planning",
        allDay: true,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      code: "calendar_account_not_found",
      message: "Calendar account not found",
    });
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it("creates a recurring calendar event when recurrence is provided", async () => {
    createCalendarEvent.mockResolvedValue({
      id: "event-recurring-1",
      title: "Work",
      accountId: "gmail-main",
      calendarId: "primary",
      recurringEventId: "event-recurring-1",
    });

    const res = await request(makeApp())
      .post("/api/calendar/events")
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Work",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "03:00",
        endTime: "08:00",
        recurrence: {
          frequency: "weekly",
          weekdays: ["MO"],
          ends: { type: "never" },
        },
      });

    expect(res.status).toBe(201);
    expect(createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-main" }),
      expect.objectContaining({
        title: "Work",
        recurrence: expect.objectContaining({ frequency: "weekly" }),
      }),
    );
    expect(calendarSearchMirror.upsertCalendarSearchMirrorOccurrence).not.toHaveBeenCalled();
    expect(calendarSearchMirror.markCalendarSearchMirrorDirty).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
        reason: "calendar-write",
      }),
    );
  });

  it("creates a batch of calendar events and reports per-item failures", async () => {
    createCalendarEvent
      .mockResolvedValueOnce({ id: "event-1", title: "Tue shift" })
      .mockRejectedValueOnce({
        status: 400,
        code: "calendar_validation_error",
        message: "Title is required.",
      });

    const res = await request(makeApp())
      .post("/api/calendar/events/batch")
      .send({
        items: [
          {
            accountId: "gmail-main",
            calendarId: "primary",
            title: "Tue shift",
            allDay: false,
            startDate: "2026-04-21",
            endDate: "2026-04-21",
            startTime: "04:15",
            endTime: "07:30",
          },
          {
            accountId: "gmail-main",
            calendarId: "primary",
            title: "",
            allDay: false,
            startDate: "2026-04-22",
            endDate: "2026-04-22",
            startTime: "04:15",
            endTime: "07:30",
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].code).toBe("calendar_validation_error");
    expect(createCalendarEvent).toHaveBeenCalledTimes(2);
  });

  it("updates a calendar event", async () => {
    updateCalendarEvent.mockResolvedValue({
      id: "event-1",
      title: "Updated",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: Date.parse("2026-04-20T16:00:00.000Z"),
    });

    const res = await request(makeApp())
      .patch("/api/calendar/events/event-1")
      .send({
        accountId: "gmail-main",
        sourceAccountId: "gmail-main",
        calendarId: "primary",
        sourceCalendarId: "work",
        etag: '"etag-1"',
        title: "Updated",
        allDay: true,
        startDate: "2026-04-20",
        endDate: "2026-04-21",
      });

    expect(res.status).toBe(200);
    expect(updateCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-main" }),
      "event-1",
      expect.objectContaining({ sourceCalendarId: "work", etag: '"etag-1"', title: "Updated" }),
    );
    expect(reminderService.recomputeUnsentRemindersForSource).toHaveBeenCalledWith(expect.objectContaining({
      userId: "test-user",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
      anchorKind: "event_start",
      anchorAt: "2026-04-20T16:00:00.000Z",
    }));
    expect(calendarSearchMirror.deleteCalendarSearchMirrorOccurrence).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "work",
        eventId: "event-1",
      }),
    );
    expect(calendarSearchMirror.upsertCalendarSearchMirrorOccurrence).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({
        id: "event-1",
        accountId: "gmail-main",
        calendarId: "primary",
      }),
    );
  });

  it("rejects moving calendar events across connected accounts", async () => {
    const res = await request(makeApp())
      .patch("/api/calendar/events/event-1")
      .send({
        accountId: "gmail-main",
        sourceAccountId: "gmail-alt",
        calendarId: "primary",
        sourceCalendarId: "primary",
        title: "Updated",
        allDay: true,
        startDate: "2026-04-20",
        endDate: "2026-04-21",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("calendar_cross_account_move_unsupported");
    expect(updateCalendarEvent).not.toHaveBeenCalled();
  });

  it("passes recurring edit scope through to the calendar service", async () => {
    updateCalendarEvent.mockResolvedValue({
      id: "event-1",
      title: "Weekly sync",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: Date.parse("2026-04-20T17:00:00.000Z"),
      isRecurring: true,
      originalStartTime: "2026-04-20T16:00:00.000Z",
    });

    const res = await request(makeApp())
      .patch("/api/calendar/events/event-1")
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-1"',
        title: "Weekly sync",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "09:00",
        endTime: "09:30",
        scope: "one",
        recurringEventId: "series-1",
        originalStartTime: "2026-04-20T16:00:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(updateCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-main" }),
      "event-1",
      expect.objectContaining({
        scope: "one",
        recurringEventId: "series-1",
        originalStartTime: "2026-04-20T16:00:00.000Z",
      }),
    );
    expect(reminderService.recomputeUnsentRemindersForSource).toHaveBeenCalledWith(expect.objectContaining({
      sourceItemId: "event-1",
      sourceOccurrenceId: "2026-04-20T16:00:00.000Z",
      anchorAt: "2026-04-20T17:00:00.000Z",
    }));
    expect(calendarSearchMirror.upsertCalendarSearchMirrorOccurrence).not.toHaveBeenCalled();
    expect(calendarSearchMirror.markCalendarSearchMirrorDirty).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
      }),
    );
  });

  it("deletes a calendar event", async () => {
    deleteCalendarEvent.mockResolvedValue(undefined);

    const res = await request(makeApp())
      .delete("/api/calendar/events/event-1")
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-1"',
      });

    expect(res.status).toBe(200);
    expect(deleteCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-main" }),
      "event-1",
      expect.objectContaining({ calendarId: "primary", etag: '"etag-1"' }),
    );
    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith(expect.objectContaining({
      userId: "test-user",
      sourceType: "calendar_event",
      sourceItemId: "event-1",
    }));
    expect(calendarSearchMirror.deleteCalendarSearchMirrorOccurrence).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
        eventId: "event-1",
      }),
    );
  });

  it("passes recurring delete scope through to the calendar service", async () => {
    deleteCalendarEvent.mockResolvedValue(undefined);

    const res = await request(makeApp())
      .delete("/api/calendar/events/event-1")
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-1"',
        scope: "one",
        recurringEventId: "series-1",
        originalStartTime: "2026-04-20T16:00:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(deleteCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-main" }),
      "event-1",
      expect.objectContaining({
        calendarId: "primary",
        scope: "one",
        recurringEventId: "series-1",
        originalStartTime: "2026-04-20T16:00:00.000Z",
      }),
    );
    expect(reminderService.deleteSourceReminders).toHaveBeenCalledWith(expect.objectContaining({
      sourceItemId: "event-1",
      sourceOccurrenceId: "2026-04-20T16:00:00.000Z",
    }));
    expect(calendarSearchMirror.deleteCalendarSearchMirrorOccurrence).not.toHaveBeenCalled();
    expect(calendarSearchMirror.markCalendarSearchMirrorDirty).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
      }),
    );
  });

  it("surfaces typed calendar errors from create", async () => {
    createCalendarEvent.mockRejectedValue({
      status: 403,
      code: "calendar_reauth_required",
      message: "Reconnect this Gmail account to edit calendar events.",
    });

    const res = await request(makeApp())
      .post("/api/calendar/events")
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Planning",
        allDay: true,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("calendar_reauth_required");
  });

  it("returns place suggestions using the saved weather coordinates as bias", async () => {
    loadUserConfig.mockResolvedValue({
      accounts: [
        {
          id: "gmail-main",
          type: "gmail",
          email: "me@example.com",
          label: "Google",
          calendar_enabled: 1,
        },
      ],
      settings: {
        weather_lat: 34.0522,
        weather_lng: -118.2437,
      },
    });
    suggestGooglePlaces.mockResolvedValue([
      {
        placeId: "place-1",
        primaryText: "McDonald's",
        secondaryText: "Los Angeles, CA",
        fullText: "McDonald's Los Angeles, CA",
      },
    ]);

    const res = await request(makeApp())
      .get("/api/calendar/places/suggest")
      .query({ q: "McDonald's", sessionToken: "session-1" });

    expect(res.status).toBe(200);
    expect(res.body.places).toHaveLength(1);
    expect(suggestGooglePlaces).toHaveBeenCalledWith("McDonald's", {
      sessionToken: "session-1",
      lat: 34.0522,
      lng: -118.2437,
    });
  });

  it("requires a query before requesting place suggestions", async () => {
    const res = await request(makeApp())
      .get("/api/calendar/places/suggest")
      .query({ sessionToken: "session-1" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "calendar_places_query_required",
      message: "q parameter required",
    });
    expect(suggestGooglePlaces).not.toHaveBeenCalled();
  });

  it("returns normalized place details for a selected place", async () => {
    getGooglePlaceDetails.mockResolvedValue({
      placeId: "place-1",
      displayName: "McDonald's",
      formattedAddress: "123 Main St, Los Angeles, CA 90012, USA",
      location: "McDonald's, 123 Main St, Los Angeles, CA 90012, USA",
      lat: 34.05,
      lng: -118.24,
    });

    const res = await request(makeApp())
      .get("/api/calendar/places/place-1")
      .query({ sessionToken: "session-1" });

    expect(res.status).toBe(200);
    expect(res.body.place.location).toBe("McDonald's, 123 Main St, Los Angeles, CA 90012, USA");
    expect(getGooglePlaceDetails).toHaveBeenCalledWith("place-1", {
      sessionToken: "session-1",
    });
  });
});
