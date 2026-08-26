import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import "./CalendarEventEditor.test-setup.ts";
import { ensureChrono } from "./events/parseCalendarTitle.ts";
import {
  commitTitleWithoutWallClock,
  renderEventEditor,
  setCompactSchedulePickerTime,
} from "./events/CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor compact schedule behavior", () => {
  beforeAll(async () => {
    await ensureChrono();
  });

  it("uses the custom time picker inside the compact schedule popover", async () => {
    renderEventEditor();
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-start-time"));
    const picker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    expect(within(picker).queryByLabelText("Start time", { selector: "input" })).toBeNull();
    expect(within(picker).queryByLabelText("End time", { selector: "input" })).toBeNull();

    setCompactSchedulePickerTime(picker, "start time", { hour: 11, minute: 45, period: "pm" });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/11:45 pm/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/12:15 am/i);
      expect(within(picker).getByTestId("calendar-compact-schedule-summary").textContent).toMatch(/11:45 pm to 12:15 am/i);
      expect(within(picker).queryByLabelText("hour")).toBeNull();
    });
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

  it("preserves an edited event's duration when NLP changes only its start time", async () => {
    renderEventEditor({
      event: {
        id: "duration-nlp",
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

    commitTitleWithoutWallClock("Deep work at 3am");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-start-time").textContent).toMatch(/3:00 am/i);
      expect(screen.getByTestId("calendar-event-end-time").textContent).toMatch(/7:30 am/i);
    });
  });
});
