import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

export const mockGetCalendarSources = vi.fn();
export const mockCreateCalendarEvent = vi.fn();
export const mockCreateCalendarEventsBatch = vi.fn();
export const mockUpdateCalendarEvent = vi.fn();
export const mockDeleteCalendarEvent = vi.fn();
export const mockGetGmailAuthUrl = vi.fn();
export const mockGetCalendarPlaceSuggestions = vi.fn();
export const mockGetCalendarPlaceDetails = vi.fn();
export const mockDeleteTodoistTask = vi.fn();
export const mockListReminders = vi.fn();
export const mockCreateReminder = vi.fn();
export const mockDeleteReminder = vi.fn();

vi.mock("@/api", () => ({
  getCalendarSearch: vi.fn(),
  getCalendarSources: (...args) => mockGetCalendarSources(...args),
  createCalendarEvent: (...args) => mockCreateCalendarEvent(...args),
  createCalendarEventsBatch: (...args) => mockCreateCalendarEventsBatch(...args),
  updateCalendarEvent: (...args) => mockUpdateCalendarEvent(...args),
  deleteCalendarEvent: (...args) => mockDeleteCalendarEvent(...args),
  getGmailAuthUrl: (...args) => mockGetGmailAuthUrl(...args),
  getCalendarPlaceSuggestions: (...args) => mockGetCalendarPlaceSuggestions(...args),
  getCalendarPlaceDetails: (...args) => mockGetCalendarPlaceDetails(...args),
  deleteTodoistTask: (...args) => mockDeleteTodoistTask(...args),
  listReminders: (...args) => mockListReminders(...args),
  createReminder: (...args) => mockCreateReminder(...args),
  deleteReminder: (...args) => mockDeleteReminder(...args),
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.useRealTimers();
  window.innerWidth = 1600;
  mockGetCalendarSources.mockResolvedValue({
    accounts: [
      {
        accountId: "gmail-main",
        accountLabel: "Google",
        accountEmail: "me@example.com",
        calendars: [
          {
            id: "primary",
            summary: "Personal",
            accessRole: "owner",
            primary: true,
            writable: true,
          },
        ],
      },
    ],
  });
  mockGetCalendarPlaceSuggestions.mockResolvedValue({ places: [] });
  mockGetCalendarPlaceDetails.mockResolvedValue({
    place: {
      placeId: "place-1",
      displayName: "McDonald's",
      formattedAddress: "123 Main St, Los Angeles, CA 90012, USA",
      location: "McDonald's, 123 Main St, Los Angeles, CA 90012, USA",
    },
  });
  mockCreateCalendarEventsBatch.mockResolvedValue({ created: [], failed: [] });
  mockListReminders.mockResolvedValue({ reminders: [] });
  mockCreateReminder.mockResolvedValue({ reminder: { id: "reminder-1" } });
  mockDeleteReminder.mockResolvedValue({ success: true });
});
