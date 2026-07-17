import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover";

afterEach(() => {
  cleanup();
});

function triggerElement() {
  const button = document.createElement("button");
  button.getBoundingClientRect = () => DOMRect.fromRect({
    x: 100,
    y: 100,
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

  it("calls onSelectItem with the activated row's id and overflow-row context", async () => {
    const onSelectItem = vi.fn();
    render(
      <CalendarCellOverflowPopover
        popover={{
          day: 20,
          label: "May 20",
          viewLabel: "Events",
          dateKey: "2026-05-20",
          triggerElement: triggerElement(),
          items: [
            { id: "event-7", title: "Design review", leadingLabel: "9:00 AM" },
          ],
        }}
        selectedItemId={null}
        onSelectItem={onSelectItem}
        onClose={vi.fn()}
      />,
    );

    const row = await screen.findByRole("button", { name: /Design review/ });
    fireEvent.click(row);

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem).toHaveBeenCalledWith(
      "event-7",
      expect.objectContaining({
        dateKey: "2026-05-20",
        anchorKind: "overflow-row",
      }),
    );
  });

  it("routes activation to the specific row clicked among several", async () => {
    const onSelectItem = vi.fn();
    render(
      <CalendarCellOverflowPopover
        popover={{
          day: 20,
          label: "May 20",
          viewLabel: "Events",
          dateKey: "2026-05-20",
          triggerElement: triggerElement(),
          items: [
            { id: "event-a", title: "Morning standup", leadingLabel: "9:00 AM" },
            { id: "event-b", title: "Lunch with Sam", leadingLabel: "12:00 PM" },
            { id: "event-c", title: "Retro", leadingLabel: "4:00 PM" },
          ],
        }}
        selectedItemId={null}
        onSelectItem={onSelectItem}
        onClose={vi.fn()}
      />,
    );

    await screen.findByRole("button", { name: /Morning standup/ });
    fireEvent.click(screen.getByRole("button", { name: /Lunch with Sam/ }));

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem).toHaveBeenCalledWith("event-b", expect.objectContaining({
      anchorKind: "overflow-row",
    }));
  });
});
