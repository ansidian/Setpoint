import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer";
import {
  createCalendarEventSelectionSet,
  isCalendarEventSelected,
  toggleCalendarEventSelection,
  type SelectableCalendarEvent,
} from "../events/calendarEventSelectionModel";

afterEach(() => {
  cleanup();
});

describe("CalendarInlineOverflowLayer", () => {
  it("modifier-selects an event from the inline overflow surface", () => {
    const event = {
      id: "event-inline",
      title: "Overflow planning",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-12T17:00:00.000Z").getTime(),
      endMs: new Date("2026-05-12T18:00:00.000Z").getTime(),
      writable: true,
    };
    function Harness() {
      const [selection, setSelection] = useState(() => createCalendarEventSelectionSet());
      return (
        <CalendarInlineOverflowLayer
          overflow={{
            inlineAnchor: { top: 0, left: 0, width: 320 },
            dateKey: "2026-05-12",
            items: [{ id: event.id, title: event.title, writable: true, sourceEvent: event }],
          }}
          quickActions={{
            isEventSelectionSelected: (candidate) => isCalendarEventSelected(selection, candidate as SelectableCalendarEvent),
            toggleEventSelection: ({ event: candidate }) => setSelection((current) => (
              toggleCalendarEventSelection(current, candidate as SelectableCalendarEvent)
            )),
          }}
        />
      );
    }

    render(<Harness />);
    const chip = screen.getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip, { ctrlKey: true });

    expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");
  });

  it("moves focus to the clicked hidden item", () => {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-05-12",
          items: [
            { id: "event-1", leadingLabel: "9:00 AM", title: "Check-in" },
            { id: "event-2", leadingLabel: "5:30 PM", title: "Wash Car" },
          ],
        }}
        selectedItemId={null}
        onSelectItem={vi.fn()}
      />,
    );

    const chips = screen.getAllByTestId("calendar-cell-item-chip");

    fireEvent.click(chips[1]!);

    expect(document.activeElement).toBe(chips[1]!);
  });

});
