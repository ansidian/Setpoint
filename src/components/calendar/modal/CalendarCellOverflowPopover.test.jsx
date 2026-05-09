import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover.jsx";

afterEach(() => {
  cleanup();
});

function triggerElement() {
  const button = document.createElement("button");
  button.getBoundingClientRect = () => ({
    top: 100,
    left: 100,
    right: 180,
    bottom: 128,
    width: 80,
    height: 28,
  });
  document.body.appendChild(button);
  return button;
}

describe("CalendarCellOverflowPopover", () => {
  it("renders upcoming reminder markers in fallback overflow rows", async () => {
    render(
      <CalendarCellOverflowPopover
        popover={{
          day: 20,
          label: "May 20",
          viewLabel: "Events",
          dateKey: "2026-05-20",
          triggerElement: triggerElement(),
          items: [
            {
              id: "event-1",
              title: "Reminder event",
              leadingLabel: "9:00 AM",
              hasUpcomingReminder: true,
            },
          ],
        }}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const row = await screen.findByTestId("calendar-cell-overflow-item");
    expect(row.querySelector("[data-calendar-chip-reminder-marker='true']")).toBeTruthy();
    expect(row.textContent).toContain("Reminder event");
  });
});
