import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover.jsx";
import { ItemChip } from "./CalendarCellItemChip.jsx";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer.jsx";

afterEach(() => {
  cleanup();
});

const sourceEvent = {
  id: "event-1",
  title: "Planning block",
  accountId: "gmail-main",
  calendarId: "primary",
  startMs: new Date("2026-05-04T16:00:00.000Z").getTime(),
  endMs: new Date("2026-05-04T17:00:00.000Z").getTime(),
  writable: true,
  color: "#89b4fa",
};

function chipItem(overrides = {}) {
  return {
    id: "event-1",
    selectionId: "event-1",
    title: "Planning block",
    sourceEvent,
    sourceItem: sourceEvent,
    writable: true,
    accent: "#89b4fa",
    ...overrides,
  };
}

describe("Calendar Event Selection Set surfaces", () => {
  it("routes modifier-clicks on month-grid chips into the Calendar Event Selection Set", () => {
    const onSelectItem = vi.fn();
    const toggleEventSelection = vi.fn(() => true);
    render(
      <ItemChip
        item={chipItem()}
        selected={false}
        active={false}
        pastTone={null}
        metrics={{ itemHeight: 36, gap: 4 }}
        quickActions={{
          isEventSelectionSelected: (event) => event?.id === "event-1",
          toggleEventSelection,
        }}
        onSelectItem={onSelectItem}
        dateKey="2026-05-04"
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");

    fireEvent.click(chip, { metaKey: true });

    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event: sourceEvent,
      dateKey: "2026-05-04",
      anchorKind: "chip",
    }));
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it("routes modifier-clicks on inline overflow chips into the Calendar Event Selection Set", () => {
    const onSelectItem = vi.fn();
    const toggleEventSelection = vi.fn(() => true);
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 280 },
          dateKey: "2026-05-04",
          items: [chipItem()],
        }}
        selectedItemId={null}
        onSelectItem={onSelectItem}
        quickActions={{
          isEventSelectionSelected: (event) => event?.id === "event-1",
          toggleEventSelection,
        }}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");

    fireEvent.click(chip, { metaKey: true });

    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event: sourceEvent,
      dateKey: "2026-05-04",
      anchorKind: "overflow-row",
    }));
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it("keeps fallback overflow open on outside clicks while building a Calendar Event Selection Set", async () => {
    const onClose = vi.fn();
    render(
      <CalendarCellOverflowPopover
        popover={{
          day: 4,
          label: "May 4",
          viewLabel: "Events",
          dateKey: "2026-05-04",
          triggerElement: document.body.appendChild(document.createElement("button")),
          items: [chipItem()],
        }}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        onClose={onClose}
        quickActions={{
          eventSelectionActive: true,
          isEventSelectionSelected: (event) => event?.id === "event-1",
          toggleEventSelection: vi.fn(() => true),
        }}
      />,
    );

    const row = await screen.findByTestId("calendar-cell-overflow-item");
    expect(row.getAttribute("data-calendar-event-selection")).toBe("true");

    fireEvent.pointerDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });
});
