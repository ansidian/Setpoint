import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../middleware/auth.js", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));
vi.mock("../platform/config-service.js", () => ({
  loadUserConfig: vi.fn(),
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
    body: { code: err.code || "calendar_error", message: err.message || "Calendar error" },
  })),
}));
vi.mock("../platform/google-places.js", () => ({
  getGooglePlaceDetails: vi.fn(),
  suggestGooglePlaces: vi.fn(),
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
vi.mock("../reminders/reminder-service.js", () => ({
  deleteSourceReminders: vi.fn(),
  recomputeUnsentRemindersForSource: vi.fn(),
}));
vi.mock("../reminders/reminder-hydration.js", () => ({
  calendarEventAnchorAt: vi.fn(),
  hydrateCalendarEventsWithReminderState: vi.fn(async (_userId, events) => events),
}));
vi.mock("../calendar/calendar-search.js", () => ({
  deadlineSearchCandidates: vi.fn(() => []),
  normalizeBillSearchCandidate: vi.fn((bill) => bill),
  normalizeEventSearchCandidate: vi.fn((event) => event),
  normalizeLimit: vi.fn(() => 20),
  rankCalendarSearchCandidates: vi.fn(() => ({ results: [], totalMatches: 0, truncated: false })),
}));
vi.mock("../calendar/calendar-search-mirror.js", () => ({
  deleteCalendarSearchMirrorOccurrence: vi.fn(),
  getCalendarSearchMirrorHealth: vi.fn(),
  listCalendarSearchMirrorOccurrences: vi.fn(),
  markCalendarSearchMirrorDirty: vi.fn(),
  requestCalendarSearchMirrorSync: vi.fn(),
  upsertCalendarSearchMirrorOccurrence: vi.fn(),
}));

process.env.EA_USER_ID = "user-1";

const tasksService = await import("../tasks/tasks-service.js");
const { applyDeadlineCurrentStatus } = await import("../dashboard/current-service.js");
const calendarRoutes = (await import("./calendar.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/calendar", calendarRoutes);
  return app;
}

function serviceError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

describe("calendar deadline mutation routes", () => {
  beforeEach(() => {
    tasksService.createDeadline.mockReset().mockResolvedValue({ id: "td-new", title: "Pay invoice" });
    tasksService.updateDeadline.mockReset().mockResolvedValue({ id: "td-1", title: "Renamed" });
    tasksService.deleteDeadline.mockReset().mockResolvedValue(undefined);
    tasksService.completeDeadlineOccurrence.mockReset().mockResolvedValue({
      completed: true,
      alreadyCompleted: false,
      deadlineId: "td-rec",
      occurrenceDate: "2026-05-12",
    });
    applyDeadlineCurrentStatus.mockReset().mockResolvedValue({ updated: true });
  });

  it("creates deadlines through the calendar deadline domain endpoint", async () => {
    const body = {
      title: "Pay invoice",
      dueDate: "2026-05-12",
      dueTime: "2:00 PM",
      projectId: "project-1",
      labelIds: ["finance"],
    };

    const res = await request(makeApp()).post("/api/calendar/deadlines").send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ deadline: { id: "td-new", title: "Pay invoice" } });
    expect(tasksService.createDeadline).toHaveBeenCalledWith("user-1", body);
  });

  it("updates deadlines through the calendar deadline domain endpoint", async () => {
    const body = { title: "Renamed", dueString: "tomorrow at 9am" };

    const res = await request(makeApp()).patch("/api/calendar/deadlines/td-1").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deadline: { id: "td-1", title: "Renamed" } });
    expect(tasksService.updateDeadline).toHaveBeenCalledWith("user-1", "td-1", body);
  });

  it("deletes deadlines through the calendar deadline domain endpoint", async () => {
    const res = await request(makeApp()).delete("/api/calendar/deadlines/td-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(tasksService.deleteDeadline).toHaveBeenCalledWith("user-1", "td-1");
  });

  it("completes an explicit deadline occurrence and updates the current cache", async () => {
    const res = await request(makeApp())
      .post("/api/calendar/deadlines/td-rec/completed-occurrences/2026-05-12")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      completed: true,
      alreadyCompleted: false,
      deadlineId: "td-rec",
      occurrenceDate: "2026-05-12",
    });
    expect(tasksService.completeDeadlineOccurrence).toHaveBeenCalledWith("user-1", "td-rec", "2026-05-12");
    expect(applyDeadlineCurrentStatus).toHaveBeenCalledWith("user-1", "td-rec", "complete");
  });

  it("does not update current cache when occurrence completion fails validation", async () => {
    tasksService.completeDeadlineOccurrence.mockRejectedValueOnce(
      serviceError("Deadline occurrence date must be YYYY-MM-DD", 400),
    );

    const res = await request(makeApp())
      .post("/api/calendar/deadlines/td-rec/completed-occurrences/not-a-date")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Deadline occurrence date must be YYYY-MM-DD" });
    expect(tasksService.completeDeadlineOccurrence).not.toHaveBeenCalled();
    expect(applyDeadlineCurrentStatus).not.toHaveBeenCalled();
  });
});
