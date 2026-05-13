import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

export const mockGetCalendarSources = vi.fn();

vi.mock("@/api", () => ({
  getCalendarSearch: vi.fn(),
  getCalendarSources: (...args) => mockGetCalendarSources(...args),
  getCalendarPlaceSuggestions: vi.fn(),
  getCalendarPlaceDetails: vi.fn(),
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  listReminders: vi.fn().mockResolvedValue({ reminders: [] }),
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  getGmailAuthUrl: vi.fn(),
  getTodoistProjects: vi.fn().mockResolvedValue([]),
  getTodoistLabels: vi.fn().mockResolvedValue([]),
  createTodoistTask: vi.fn(),
  updateTodoistTask: vi.fn(),
  deleteTodoistTask: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem("calendar:eventsDeadlineOverlay");
  window.localStorage.removeItem("calendar:eventsCompletedDeadlines");
  mockGetCalendarSources.mockResolvedValue({
    accounts: [
      {
        accountId: "gmail-main",
        accountLabel: "Google",
        accountEmail: "me@example.com",
        calendars: [{ id: "primary", summary: "Personal", writable: true, primary: true }],
      },
    ],
  });
});
