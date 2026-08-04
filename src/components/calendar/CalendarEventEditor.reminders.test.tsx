import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockCreateCalendarEvent, mockListReminders, mockCreateReminder } from "./CalendarEventEditor.test-setup.ts";
import {
  getActiveEventSaveButton,
  renderEventEditor,
} from "./events/CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor reminder behavior", () => {
  it("adds pending reminder chips during event create and flushes them after provider creation succeeds", async () => {
    renderEventEditor({ focusDate: "2099-05-10" });
    const savedEvent = {
      id: "event-reminder-create",
      title: "Planning block",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2099-05-10T16:00:00.000Z").getTime(),
      endMs: new Date("2099-05-10T16:30:00.000Z").getTime(),
      writable: true,
      allDay: false,
    };
    mockCreateCalendarEvent.mockResolvedValue({ event: savedEvent });

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block" },
    });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    vi.useRealTimers();
    fireEvent.click(screen.getByTestId("calendar-event-reminder-preset-30"));

    expect(screen.getByTestId("calendar-event-reminder-chip").textContent).toMatch(/30 minutes before/i);

    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-save") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Reminder persistence is a separate outbound API write whose anchor, source identity, and offset are not observable from the closed editor alone.
      expect(mockCreateReminder).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: "calendar_event",
        sourceItemId: "event-reminder-create",
        anchorKind: "event_start",
        anchorAt: "2099-05-10T16:00:00.000Z",
        offsetMinutes: -30,
      }));
      const observed = screen.getByTestId("calendar-editor-observed-upserts").textContent || "";
      expect(observed).toContain(savedEvent.id);
      expect(observed).toContain('"nextReminderAt":"2099-05-10T15:30:00.000Z"');
    });
  });

  it("loads existing reminders while editing and keeps sent reminders visually distinct", async () => {
    const event = {
      id: "event-reminder-edit",
      etag: '"etag-reminder-edit"',
      title: "Planning block",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockListReminders.mockResolvedValueOnce({
      reminders: [
        { id: "reminder-future", status: "pending", offset_minutes: -60 },
        { id: "reminder-sent", status: "sent", offset_minutes: -30 },
      ],
    });
    renderEventEditor({ event });

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Reminder hydration must query the outbound reminders API with the event and occurrence identity; rendered chips do not reveal the query scope.
      expect(mockListReminders).toHaveBeenCalledWith({
        sourceType: "calendar_event",
        sourceItemId: "event-reminder-edit",
        sourceOccurrenceId: null,
      });
      expect(screen.getAllByTestId("calendar-event-reminder-chip")).toHaveLength(2);
    });
    expect(screen.getByText(/1 hour before/i)).toBeTruthy();
    expect(screen.getByText(/sent/i)).toBeTruthy();
  });
});
