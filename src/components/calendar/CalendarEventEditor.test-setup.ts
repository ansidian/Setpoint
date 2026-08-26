import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

export const mockGetCalendarSources = vi.fn();
export const mockCreateCalendarEvent = vi.fn();
export const mockCreateCalendarEventsBatch = vi.fn();
export const mockUpdateCalendarEvent = vi.fn();
export const mockDeleteCalendarEvent = vi.fn();
export const mockGetCalendarEvent = vi.fn();
export const mockGetGmailAuthUrl = vi.fn();
export const mockGetCalendarPlaceSuggestions = vi.fn();
export const mockGetCalendarPlaceDetails = vi.fn();
export const mockDeleteTodoistTask = vi.fn();
export const mockListReminders = vi.fn();
export const mockCreateReminder = vi.fn();
export const mockDeleteReminder = vi.fn();

vi.mock("@/api", () => ({
  getCalendarSearch: vi.fn(),
  getCalendarSources: (...args: unknown[]) => mockGetCalendarSources(...args),
  createCalendarEvent: (...args: unknown[]) => mockCreateCalendarEvent(...args),
  createCalendarEventsBatch: (...args: unknown[]) => mockCreateCalendarEventsBatch(...args),
  updateCalendarEvent: (...args: unknown[]) => mockUpdateCalendarEvent(...args),
  deleteCalendarEvent: (...args: unknown[]) => mockDeleteCalendarEvent(...args),
  getCalendarEvent: (...args: unknown[]) => mockGetCalendarEvent(...args),
  getGmailAuthUrl: (...args: unknown[]) => mockGetGmailAuthUrl(...args),
  getCalendarPlaceSuggestions: (...args: unknown[]) => mockGetCalendarPlaceSuggestions(...args),
  getCalendarPlaceDetails: (...args: unknown[]) => mockGetCalendarPlaceDetails(...args),
  deleteTodoistTask: (...args: unknown[]) => mockDeleteTodoistTask(...args),
  listReminders: (...args: unknown[]) => mockListReminders(...args),
  createReminder: (...args: unknown[]) => mockCreateReminder(...args),
  deleteReminder: (...args: unknown[]) => mockDeleteReminder(...args),
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
  mockGetCalendarEvent.mockResolvedValue({ event: null });
});
