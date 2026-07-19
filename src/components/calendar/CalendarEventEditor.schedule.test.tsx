import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarEventEditor.test-setup.ts";
import {
  renderEventEditor,
  setCompactSchedulePickerTime,
} from "./events/CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor compact schedule behavior", () => {
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
});
