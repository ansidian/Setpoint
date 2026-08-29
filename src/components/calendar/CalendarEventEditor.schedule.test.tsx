import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import "./CalendarEventEditor.test-setup.ts";
import { ensureChrono } from "./events/parseCalendarTitle.ts";
import { renderEventEditor, setCompactSchedulePickerTime } from "./events/CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor compact schedule behavior", () => {
  beforeAll(async () => {
    await ensureChrono();
  });

  it("preserves an edited event's duration when the time picker changes its start time", async () => {
    renderEventEditor({
      event: {
        id: "duration-picker",
        title: "Deep work",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T10:30:00.000Z").getTime(),
        endMs: new Date("2026-04-20T15:00:00.000Z").getTime(),
        writable: true,
        allDay: false,
      },
    });
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-start-time"));
    const picker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    setCompactSchedulePickerTime(picker, "start time", { hour: 3, minute: 0, period: "am" });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/3:00 am/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/7:30 am/i);
    });
  });

});
