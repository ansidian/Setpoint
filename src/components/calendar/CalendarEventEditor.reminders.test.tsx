import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockListReminders } from "./CalendarEventEditor.test-setup.ts";
import {
  renderEventEditor,
} from "./events/CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor reminder behavior", () => {
  it("loads existing reminders for the exact event occurrence", async () => {
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
  });
});
