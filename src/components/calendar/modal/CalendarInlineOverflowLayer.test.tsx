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

  it("keeps compact time labels visible and renders deadline status icons", () => {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-05-12",
          leadingColumnWidth: 35,
          items: [
            {
              id: "deadline:todo-done:2026-05-12",
              leadingLabel: "11:59 PM",
              title: "Teamwork Assessment",
              complete: true,
              statusIcon: "complete",
              detailKind: "deadline",
              sourceItem: { id: "todo-done" },
            },
            {
              id: "todoist:todo-done",
              leadingLabel: "11:59 PM",
              title: "Project Deliverables",
              complete: true,
              statusIcon: "complete",
              detailKind: "deadline",
              sourceItem: { id: "todo-done" },
            },
          ],
        }}
        selectedItemId={null}
      />,
    );

    const chips = screen.getAllByTestId("calendar-cell-item-chip");
    const firstMeta = chips[0]!.querySelector<HTMLElement>("[data-calendar-chip-meta='true']");
    const firstIcon = chips[0]!.querySelector<HTMLElement>("[data-calendar-chip-status-icon='complete']");
    const secondIcon = chips[1]!.querySelector<HTMLElement>("[data-calendar-chip-status-icon='complete']");

    expect(firstMeta?.textContent).toContain("11:59p");
    expect(firstIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(firstIcon?.closest("s")).toBeNull();
    expect(chips[0]!.textContent).toContain("Teamwork Assessment");
    expect(chips[0]!.querySelector("[data-calendar-chip-title-text='true']")?.closest("s")).toBeTruthy();
    expect(secondIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(chips[1]!.textContent).toContain("Project Deliverables");

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

  it("carries a month boundary below adjacent-month inline overflow", () => {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-04-26",
          boundarySides: ["bottom"],
          boundaryColor: "#0095FF",
          items: [
            { id: "event-1", leadingLabel: "10:00 AM", title: "Submit taxes" },
          ],
        }}
        selectedItemId={null}
      />,
    );

    const boundary = screen.getByTestId("calendar-cell-inline-overflow")
      .querySelector<HTMLElement>("[data-calendar-inline-overflow-boundary='bottom']");

    expect(boundary).toBeTruthy();
    expect(
      screen.getByTestId("calendar-cell-inline-overflow")
        .querySelector("[data-calendar-inline-overflow-boundary='cross-month']"),
    ).toBeNull();
  });

  it("carries a crossed current-month boundary below inline overflow", () => {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 320 },
          dateKey: "2026-05-26",
          carryBoundaryToBottom: true,
          boundaryColor: "#0095FF",
          items: [
            { id: "event-1", leadingLabel: "1:00 PM", title: "Return adapter" },
          ],
        }}
        selectedItemId={null}
      />,
    );

    const boundary = screen.getByTestId("calendar-cell-inline-overflow")
      .querySelector<HTMLElement>("[data-calendar-inline-overflow-boundary='bottom']");

    expect(boundary).toBeTruthy();
  });
});
