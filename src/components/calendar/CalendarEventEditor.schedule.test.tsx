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

  it("dismisses each event fact picker when its trigger is clicked again", async () => {
    renderEventEditor();
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    const cases = [
      ["calendar-event-schedule-trigger", /compact schedule picker/i],
      ["calendar-event-source-trigger", /calendar source picker/i],
      ["calendar-event-location-trigger", /location suggestions/i],
      ["calendar-event-repeat-trigger", /recurrence picker/i],
    ] as const;

    for (const [triggerTestId, dialogName] of cases) {
      const trigger = screen.getByTestId(triggerTestId);
      fireEvent.click(trigger);
      expect(await screen.findByRole("dialog", { name: dialogName })).toBeTruthy();

      fireEvent.click(trigger);
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: dialogName })).toBeNull();
      });
    }
  });

});
