import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import {
  createCalendarEventSelectionSet,
  isCalendarEventSelected,
  toggleCalendarEventSelection,
  type SelectableCalendarEvent,
} from "../events/calendarEventSelectionModel";
import CalendarCellOverflowItem from "./CalendarCellOverflowItem";

describe("CalendarCellOverflowItem", () => {
  it("modifier-selects an event from the overflow-popover surface", () => {
    const event = {
      id: "event-popover",
      title: "Overflow planning",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-12T17:00:00.000Z").getTime(),
      endMs: new Date("2026-05-12T18:00:00.000Z").getTime(),
      writable: true,
    };
    function Harness() {
      const popoverRef = useRef<HTMLDivElement | null>(null);
      const [selection, setSelection] = useState(() => createCalendarEventSelectionSet());
      return (
        <CalendarCellOverflowItem
          item={{ id: event.id, title: event.title, writable: true, sourceEvent: event }}
          selected={false}
          active={false}
          leadingColumnWidth={0}
          interaction={{
            dateKey: "2026-05-12",
            popoverRef,
            quickActions: {
              isEventSelectionSelected: (candidate) => isCalendarEventSelected(selection, candidate as SelectableCalendarEvent),
              toggleEventSelection: ({ event: candidate }) => setSelection((current) => (
                toggleCalendarEventSelection(current, candidate as SelectableCalendarEvent)
              )),
            },
            onActivate: () => {},
            onDeactivate: () => {},
          }}
        />
      );
    }

    render(<Harness />);
    const row = screen.getByTestId("calendar-cell-overflow-item");
    fireEvent.click(row, { metaKey: true });

    expect(row.getAttribute("data-calendar-event-selection")).toBe("true");
  });
});
