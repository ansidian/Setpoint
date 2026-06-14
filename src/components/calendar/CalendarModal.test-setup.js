import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
// Eagerly load the lazy AddTaskPanel chunk (the deadline create/edit inline
// editor, behind React.lazy in DeadlinesDetailRail's Suspense) so calendar
// tests assert on the editor's behavior rather than racing a cold dynamic
// import against findBy's budget. The chunk transforms slowly on a cold cache
// under full-suite CPU/transform contention, which intermittently times out
// `findByTestId("todoist-inline-editor")`. Production still lazy-loads it; this
// import only warms vitest's module cache for the test environment.
import "@/components/todoist/AddTaskPanel";

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
