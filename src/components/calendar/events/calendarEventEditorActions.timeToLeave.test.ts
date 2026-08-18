import { describe, expect, it, vi } from "vitest";
import { saveCalendarEventAction } from "./calendarEventEditorActions";

describe("calendarEventEditorActions Time-to-Leave projection", () => {
  it("keeps the grounded departure trigger separate from an at-start reminder", async () => {
    const eventStart = "2099-05-06T18:00:00.000Z";
    const leaveAt = "2099-05-06T16:45:00.000Z";
    const editingEvent = {
      id: "event-1",
      title: "Dentist",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: Date.parse(eventStart),
      endMs: Date.parse("2099-05-06T18:30:00.000Z"),
      allDay: false,
    };
    const savedEvent = { ...editingEvent, location: "500 Pine Street" };
    const client = {
      update: vi.fn().mockResolvedValue({ event: savedEvent }),
      createReminder: vi.fn().mockResolvedValue({
        reminder: {
          id: "ttl-1",
          reminder_kind: "time_to_leave",
          status: "pending",
          offset_minutes: 0,
          remind_at: leaveAt,
          arrival_buffer_minutes: 15,
        },
      }),
    };

    const result = await saveCalendarEventAction({
      draft: {
        accountId: "gmail-main",
        calendarId: "primary",
        title: "Dentist",
        allDay: false,
        startDate: "2099-05-06",
        endDate: "2099-05-06",
        startTime: "11:00",
        endTime: "11:30",
        location: "500 Pine Street",
        description: "",
      },
      effectiveTitle: "Dentist",
      editingEvent,
      intentMode: "single",
      eventReminders: {
        items: [
          {
            id: "at-start",
            reminder_kind: "fixed",
            status: "pending",
            offset_minutes: 0,
            remind_at: eventStart,
          },
          {
            clientId: "time-to-leave-15",
            reminder_kind: "time_to_leave",
            status: "pending",
            arrival_buffer_minutes: 15,
          },
        ],
        removedIds: [],
      },
    }, client);

    expect(result.savedEvent.reminderState).toEqual({
      hasUpcomingReminder: true,
      upcomingCount: 2,
      nextReminderAt: leaveAt,
    });
  });
});
