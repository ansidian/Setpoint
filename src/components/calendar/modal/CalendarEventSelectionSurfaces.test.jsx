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

  it("keeps special-date month-grid chips out of the Calendar Event Selection Set", () => {
    const onSelectItem = vi.fn();
    const toggleEventSelection = vi.fn(() => true);
    render(
      <ItemChip
        item={chipItem({
          specialDate: true,
          specialDateAccent: "#ff887c",
          title: "Maya's birthday",
          writable: false,
        })}
        selected={false}
        active={false}
        pastTone={null}
        metrics={{ itemHeight: 36, gap: 4 }}
        quickActions={{
          isEventSelectionSelected: () => true,
          toggleEventSelection,
        }}
        onSelectItem={onSelectItem}
        dateKey="2026-05-04"
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();

    fireEvent.click(chip, { metaKey: true });

    expect(toggleEventSelection).not.toHaveBeenCalled();
    expect(onSelectItem).not.toHaveBeenCalled();

    fireEvent.click(chip);

    expect(onSelectItem).toHaveBeenCalledWith("event-1", expect.objectContaining({
      dateKey: "2026-05-04",
      anchorKind: "chip",
    }));
    expect(onSelectItem.mock.calls[0][1].preserveEventSelection).toBeFalsy();
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

  it("keeps special-date inline overflow chips out of the Calendar Event Selection Set", () => {
    const onSelectItem = vi.fn();
    const toggleEventSelection = vi.fn(() => true);
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 280 },
          dateKey: "2026-05-04",
          items: [chipItem({
            title: "Maya's birthday",
            specialDate: true,
            specialDateAccent: "#ff887c",
            writable: false,
          })],
        }}
        selectedItemId={null}
        onSelectItem={onSelectItem}
        quickActions={{
          isEventSelectionSelected: () => true,
          toggleEventSelection,
        }}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.querySelector("[data-calendar-special-date-badge='true']")).toBeTruthy();
    expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();

    fireEvent.click(chip, { metaKey: true });

    expect(toggleEventSelection).not.toHaveBeenCalled();
    expect(onSelectItem).not.toHaveBeenCalled();

    fireEvent.click(chip);

    expect(onSelectItem).toHaveBeenCalledWith("event-1", expect.objectContaining({
      dateKey: "2026-05-04",
      anchorKind: "overflow-row",
    }));
    expect(onSelectItem.mock.calls[0][1].preserveEventSelection).toBeFalsy();
  });

  it("renders special-date fallback overflow rows as markers outside batch selection", async () => {
    const onSelectItem = vi.fn();
    const toggleEventSelection = vi.fn(() => true);
    render(
      <CalendarCellOverflowPopover
        popover={{
          day: 4,
          label: "May 4",
          viewLabel: "Events",
          dateKey: "2026-05-04",
          triggerElement: document.body.appendChild(document.createElement("button")),
          items: [chipItem({
            title: "Maya's birthday",
            specialDate: true,
            specialDateAccent: "#ff887c",
            writable: false,
          })],
        }}
        selectedItemId={null}
        onSelectItem={onSelectItem}
        onClose={vi.fn()}
        quickActions={{
          isEventSelectionSelected: () => true,
          toggleEventSelection,
        }}
      />,
    );

    const row = await screen.findByTestId("calendar-cell-overflow-item");
    expect(row.querySelector("[data-calendar-special-date-badge='true']")).toBeTruthy();
    expect(row.getAttribute("data-calendar-event-selection")).toBeNull();

    fireEvent.click(row, { metaKey: true });

    expect(toggleEventSelection).not.toHaveBeenCalled();
    expect(onSelectItem).not.toHaveBeenCalled();

    fireEvent.click(row);

    expect(onSelectItem).toHaveBeenCalledWith("event-1", expect.objectContaining({
      dateKey: "2026-05-04",
      anchorKind: "overflow-row",
    }));
    expect(onSelectItem.mock.calls[0][1].preserveEventSelection).toBeFalsy();
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
