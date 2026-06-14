import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockCreateCalendarEvent, mockListReminders, mockCreateReminder } from "./CalendarEventEditor.test-setup.js";
import { renderModal, openFloatingEventEditorFromSelectedChip, getActiveEventSaveButton } from "./CalendarEventEditor.test-utils.jsx";

describe("CalendarEventEditor reminder behavior", () => {
  it("adds pending reminder chips during event create and flushes them after provider creation succeeds", async () => {
    const { upsertEvents } = renderModal({ focusDate: "2099-05-10" });
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

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block" },
    });
    fireEvent.click(screen.getByTestId("calendar-event-reminder-preset-30"));

    expect(screen.getByTestId("calendar-event-reminder-chip").textContent).toMatch(/30 minutes before/i);

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
    });
    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
      expect(mockCreateReminder).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: "calendar_event",
        sourceItemId: "event-reminder-create",
        anchorKind: "event_start",
        anchorAt: "2099-05-10T16:00:00.000Z",
        offsetMinutes: -30,
      }));
      expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({
        ...savedEvent,
        hasUpcomingReminder: true,
        upcomingReminderCount: 1,
        nextReminderAt: "2099-05-10T15:30:00.000Z",
        reminderState: {
          hasUpcomingReminder: true,
          upcomingCount: 1,
          nextReminderAt: "2099-05-10T15:30:00.000Z",
        },
      }));
    });
  });

  it("does not flush pending reminders when event creation fails", async () => {
    renderModal({ focusDate: "2099-05-10" });
    mockCreateCalendarEvent.mockRejectedValue(new Error("Google Calendar failed"));

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block" },
    });
    fireEvent.click(screen.getByTestId("calendar-event-reminder-preset-30"));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-save").disabled).toBe(false);
    });
    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(screen.getByText("Google Calendar failed")).toBeTruthy();
    });
    expect(mockCreateReminder).not.toHaveBeenCalled();
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
    renderModal({ events: [event] });

    await openFloatingEventEditorFromSelectedChip();

    await waitFor(() => {
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
