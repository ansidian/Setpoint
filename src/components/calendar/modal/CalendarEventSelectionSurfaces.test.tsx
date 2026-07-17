import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarChipItem, CalendarItemQuickActions } from "./CalendarCellItemChip";
import CalendarCellOverflowPopover from "./CalendarCellOverflowPopover";
import { ItemChip } from "./CalendarCellItemChip";
import CalendarInlineOverflowLayer from "./CalendarInlineOverflowLayer";

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

// A deadline chip has NO sourceEvent (so the event drag gate never matches);
// it carries itemKind/recurring/complete + a raw sourceItem with due fields.
function deadlineChipItem(overrides = {}) {
  return {
    id: "todo-1",
    selectionId: "todo-1",
    title: "Pay rent",
    itemKind: "deadline",
    recurring: false,
    complete: false,
    accent: "#f9e2af",
    sourceItem: {
      id: "todo-1",
      due_date: "2026-05-04",
      due_time: "3:00 PM",
      is_recurring: false,
      status: "needs_action",
    },
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

  it("forwards special-date month-grid chip modifier-clicks without marking selection", () => {
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

    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event: sourceEvent,
      dateKey: "2026-05-04",
      anchorKind: "chip",
    }));
    expect(onSelectItem).not.toHaveBeenCalled();

    fireEvent.click(chip);

    expect(onSelectItem).toHaveBeenCalledWith("event-1", expect.objectContaining({
      dateKey: "2026-05-04",
      anchorKind: "chip",
    }));
    expect(onSelectItem.mock.calls[0]![1].preserveEventSelection).toBeFalsy();
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

  it("forwards special-date inline overflow chip modifier-clicks without marking selection", () => {
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

    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event: sourceEvent,
      dateKey: "2026-05-04",
      anchorKind: "overflow-row",
    }));
    expect(onSelectItem).not.toHaveBeenCalled();

    fireEvent.click(chip);

    expect(onSelectItem).toHaveBeenCalledWith("event-1", expect.objectContaining({
      dateKey: "2026-05-04",
      anchorKind: "overflow-row",
    }));
    expect(onSelectItem.mock.calls[0]![1].preserveEventSelection).toBeFalsy();
  });

  it("forwards special-date fallback overflow row modifier-clicks without marking selection", async () => {
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

    expect(toggleEventSelection).toHaveBeenCalledWith(expect.objectContaining({
      event: sourceEvent,
      dateKey: "2026-05-04",
      anchorKind: "overflow-row",
    }));
    expect(onSelectItem).not.toHaveBeenCalled();

    fireEvent.click(row);

    expect(onSelectItem).toHaveBeenCalledWith("event-1", expect.objectContaining({
      dateKey: "2026-05-04",
      anchorKind: "overflow-row",
    }));
    expect(onSelectItem.mock.calls[0]![1].preserveEventSelection).toBeFalsy();
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

describe("Deadline chip drag affordance", () => {
  it("makes a non-recurring deadline chip draggable and writes the deadline payload on drag start", () => {
    const beginDeadlineDrag = vi.fn(() => true);
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    const item = deadlineChipItem();
    render(
      <ItemChip
        item={item}
        selected={false}
        active={false}
        pastTone={null}
        metrics={{ itemHeight: 36, gap: 4 }}
        quickActions={{ deadlineDragEnabled: true, beginDeadlineDrag }}
        onSelectItem={vi.fn()}
        dateKey="2026-05-04"
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.getAttribute("draggable")).toBe("true");

    fireEvent.dragStart(chip, { dataTransfer });

    expect(beginDeadlineDrag).toHaveBeenCalledWith(expect.objectContaining({ id: "todo-1", due_time: "3:00 PM" }));
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-ea-calendar-deadline",
      JSON.stringify(item.sourceItem),
    );
  });

  it("does not make a recurring or completed deadline chip draggable", () => {
    const props = {
      selected: false,
      active: false,
      pastTone: null,
      metrics: { itemHeight: 36, gap: 4 },
      quickActions: { deadlineDragEnabled: true, beginDeadlineDrag: vi.fn(() => true) },
      onSelectItem: vi.fn(),
      dateKey: "2026-05-04",
    };
    const { rerender } = render(<ItemChip item={deadlineChipItem({ recurring: true })} {...props} />);
    expect(screen.getByTestId("calendar-cell-item-chip").getAttribute("draggable")).toBe("false");

    rerender(<ItemChip item={deadlineChipItem({ complete: true })} {...props} />);
    expect(screen.getByTestId("calendar-cell-item-chip").getAttribute("draggable")).toBe("false");
  });

  it("does not make a deadline chip draggable when drag is disabled (mobile)", () => {
    render(
      <ItemChip
        item={deadlineChipItem()}
        selected={false}
        active={false}
        pastTone={null}
        metrics={{ itemHeight: 36, gap: 4 }}
        quickActions={{ deadlineDragEnabled: false, beginDeadlineDrag: vi.fn(() => true) }}
        onSelectItem={vi.fn()}
        dateKey="2026-05-04"
      />,
    );

    expect(screen.getByTestId("calendar-cell-item-chip").getAttribute("draggable")).toBe("false");
  });
});

describe("Deadline overflow drag affordance (popover)", () => {
  function renderPopover(item: CalendarChipItem, quickActions: CalendarItemQuickActions, onClose = vi.fn()) {
    render(
      <CalendarCellOverflowPopover
        popover={{
          day: 4,
          label: "May 4",
          viewLabel: "Events",
          dateKey: "2026-05-04",
          triggerElement: document.body.appendChild(document.createElement("button")),
          items: [item],
        }}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        onClose={onClose}
        quickActions={quickActions}
      />,
    );
  }

  it("makes a non-recurring deadline overflow row draggable and writes the deadline payload", async () => {
    const beginDeadlineDrag = vi.fn(() => true);
    const onClose = vi.fn();
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    const item = deadlineChipItem();
    renderPopover(item, { deadlineDragEnabled: true, beginDeadlineDrag }, onClose);

    const row = await screen.findByTestId("calendar-cell-overflow-item");
    expect(row.getAttribute("draggable")).toBe("true");

    fireEvent.dragStart(row, { dataTransfer });

    expect(beginDeadlineDrag).toHaveBeenCalledWith(expect.objectContaining({ id: "todo-1", due_time: "3:00 PM" }));
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-ea-calendar-deadline",
      JSON.stringify(item.sourceItem),
    );
    // Drag-start closes the popover so the drop lands on the day cell beneath it.
    expect(onClose).toHaveBeenCalled();
  });

  it("does not make a recurring or completed deadline overflow row draggable", async () => {
    renderPopover(deadlineChipItem({ recurring: true }), { deadlineDragEnabled: true, beginDeadlineDrag: vi.fn(() => true) });
    expect((await screen.findByTestId("calendar-cell-overflow-item")).getAttribute("draggable")).toBe("false");

    cleanup();

    renderPopover(deadlineChipItem({ complete: true }), { deadlineDragEnabled: true, beginDeadlineDrag: vi.fn(() => true) });
    expect((await screen.findByTestId("calendar-cell-overflow-item")).getAttribute("draggable")).toBe("false");
  });
});

describe("Deadline overflow drag affordance (inline)", () => {
  function renderInline(item: CalendarChipItem, quickActions: CalendarItemQuickActions) {
    render(
      <CalendarInlineOverflowLayer
        overflow={{
          inlineAnchor: { top: 0, left: 0, width: 280 },
          dateKey: "2026-05-04",
          items: [item],
        }}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        quickActions={quickActions}
      />,
    );
  }

  it("makes a non-recurring deadline inline-overflow chip draggable and writes the deadline payload", () => {
    const beginDeadlineDrag = vi.fn(() => true);
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    const item = deadlineChipItem();
    renderInline(item, { deadlineDragEnabled: true, beginDeadlineDrag });

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.getAttribute("draggable")).toBe("true");

    fireEvent.dragStart(chip, { dataTransfer });

    expect(beginDeadlineDrag).toHaveBeenCalledWith(expect.objectContaining({ id: "todo-1", due_time: "3:00 PM" }));
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-ea-calendar-deadline",
      JSON.stringify(item.sourceItem),
    );
  });

  it("does not make a recurring or completed deadline inline-overflow chip draggable", () => {
    renderInline(deadlineChipItem({ recurring: true }), { deadlineDragEnabled: true, beginDeadlineDrag: vi.fn(() => true) });
    expect(screen.getByTestId("calendar-cell-item-chip").getAttribute("draggable")).toBe("false");

    cleanup();

    renderInline(deadlineChipItem({ complete: true }), { deadlineDragEnabled: true, beginDeadlineDrag: vi.fn(() => true) });
    expect(screen.getByTestId("calendar-cell-item-chip").getAttribute("draggable")).toBe("false");
  });
});
