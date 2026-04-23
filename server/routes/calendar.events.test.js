import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

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
  getCalendarSourceGroups: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  formatCalendarRouteError: vi.fn((err) => ({
    status: err.status || 500,
    body: { code: err.code || "unknown", message: err.message || "unknown" },
  })),
}));
vi.mock("../briefing/google-places.js", () => ({
  suggestGooglePlaces: vi.fn(),
  getGooglePlaceDetails: vi.fn(),
}));
vi.mock("../briefing/ctm.js", () => ({ fetchCTMDeadlinesAll: vi.fn() }));
vi.mock("../briefing/todoist.js", () => ({ fetchTodoistTasksAll: vi.fn() }));
vi.mock("../briefing/tombstones.js", () => ({
  hydrateRecurringTombstones: vi.fn(),
  addDaysIso: vi.fn(),
}));
vi.mock("../db/connection.js", () => ({ default: { execute: vi.fn() } }));

const { loadUserConfig } = await import("../briefing/index.js");
const {
  getCalendarSourceGroups,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} = await import("../briefing/calendar.js");
const {
  suggestGooglePlaces,
  getGooglePlaceDetails,
} = await import("../briefing/google-places.js");
const calendarRoutes = (await import("./calendar.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/calendar", calendarRoutes);
  return app;
}

describe("calendar event routes", () => {
  beforeEach(() => {
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
      });

    expect(res.status).toBe(201);
    expect(createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-main" }),
      expect.objectContaining({ title: "Planning", calendarId: "primary" }),
    );
  });

  it("creates a recurring calendar event when recurrence is provided", async () => {
    createCalendarEvent.mockResolvedValue({
      id: "event-recurring-1",
      title: "Work",
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
    updateCalendarEvent.mockResolvedValue({ id: "event-1", title: "Updated" });

    const res = await request(makeApp())
      .patch("/api/calendar/events/event-1")
      .send({
        accountId: "gmail-main",
        calendarId: "primary",
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
      expect.objectContaining({ etag: '"etag-1"', title: "Updated" }),
    );
  });

  it("passes recurring edit scope through to the calendar service", async () => {
    updateCalendarEvent.mockResolvedValue({ id: "event-1", title: "Weekly sync" });

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
        scope: "following",
        recurringEventId: "series-1",
        originalStartTime: "2026-04-20T16:00:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(updateCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gmail-main" }),
      "event-1",
      expect.objectContaining({
        scope: "following",
        recurringEventId: "series-1",
        originalStartTime: "2026-04-20T16:00:00.000Z",
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
