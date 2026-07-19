import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarCellItemStack from "./CalendarCellItemStack";
import { ItemChip } from "./CalendarCellItemChip";
import type { ComponentProps, ReactNode } from "react";

const metrics = {
  itemHeight: 30,
  moreHeight: 28,
  gap: 4,
  fullVisibleCount: 3,
  overflowVisibleCount: 2,
};

afterEach(() => {
  cleanup();
});

describe("CalendarCellItemStack ghost visibility", () => {
  it("renders metadata as a compact run-in prefix and marks recurring items passively", () => {
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "Weekly sync", recurring: true },
        ]}
        metrics={metrics}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    const meta = chip.querySelector("[data-calendar-chip-meta='true']");
    const content = chip.querySelector("[data-calendar-chip-content='true']");
    const title = chip.querySelector("[data-calendar-chip-title-text='true']");

    expect(meta?.textContent).toContain("9a");
    expect(title?.textContent).toBe("Weekly sync");
    expect(chip.querySelector("[data-calendar-chip-recurring='true']")).toBeTruthy();
    expect(content?.contains(meta)).toBe(true);
    expect(content?.contains(title)).toBe(true);
  });

  it("renders Google special dates as cake-badge markers without all-day or recurring metadata", () => {
    render(
      <CalendarCellItemStack
        day={22}
        items={[
          {
            id: "birthday-1",
            leadingLabel: "All day",
            title: "Maya's birthday",
            recurring: true,
            specialDate: true,
            specialDateAccent: "#ff887c",
          },
        ]}
        metrics={{ ...metrics, itemHeight: 36, fullVisibleCount: 1 }}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.querySelector("[data-calendar-special-date-badge='true']")).toBeTruthy();
    expect(chip.querySelector("[data-calendar-chip-meta='true']")).toBeNull();
    expect(chip.querySelector("[data-calendar-chip-recurring='true']")).toBeNull();
    expect(chip.textContent).toContain("Maya's birthday");
    expect(chip.textContent).not.toContain("All day");
  });

  it("renders upcoming reminder markers without adding a title column", () => {
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          {
            id: "reminder",
            leadingLabel: "9:00 AM",
            title: "Reminder hold",
            hasUpcomingReminder: true,
          },
        ]}
        metrics={{ ...metrics, itemHeight: 36, fullVisibleCount: 1 }}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.querySelector("[data-calendar-chip-reminder-marker='true']")).toBeTruthy();
  });

  it("does not report unchanged hidden composition on parent rerender", () => {
    const onHiddenItemsChange = vi.fn();
    const items = [
      { id: "visible", leadingLabel: "9:00 AM", title: "Visible hold" },
      { id: "hidden-time", leadingLabel: "11:59 PM", title: "Hidden deadline" },
      { id: "hidden-later", leadingLabel: "10:00 PM", title: "Other hidden" },
    ];
    const { rerender } = render(
      <CalendarCellItemStack
        dateKey="2026-05-10"
        day={10}
        items={items}
        metrics={{ ...metrics, fullVisibleCount: 1, overflowVisibleCount: 1 }}
        onHiddenItemsChange={onHiddenItemsChange}
      />,
    );

    expect(onHiddenItemsChange).toHaveBeenCalledTimes(1);

    rerender(
      <CalendarCellItemStack
        dateKey="2026-05-10"
        day={10}
        items={items.map((item) => ({ ...item }))}
        metrics={{ ...metrics, fullVisibleCount: 1, overflowVisibleCount: 1 }}
        onHiddenItemsChange={onHiddenItemsChange}
      />,
    );

    expect(onHiddenItemsChange).toHaveBeenCalledTimes(1);
  });

  it("uses selection id for chip anchors while preserving source occurrence id", () => {
    const onSelectItem = vi.fn();
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          {
            id: "schedule-1:2026-05-10",
            selectionId: "schedule-1",
            renderKey: "bill:schedule-1",
            layoutId: "calendar-bill-chip:schedule-1",
            leadingLabel: "$42",
            title: "Internet",
            sourceItem: { id: "schedule-1:2026-05-10", scheduleId: "schedule-1" },
          },
        ]}
        metrics={metrics}
        onSelectItem={onSelectItem}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.getAttribute("data-item-id")).toBe("schedule-1");
    expect(chip.getAttribute("data-source-item-id")).toBe("schedule-1:2026-05-10");
    fireEvent.click(chip);
    expect(onSelectItem).toHaveBeenCalledWith("schedule-1", expect.objectContaining({
      itemsSnapshot: [expect.objectContaining({ id: "schedule-1:2026-05-10" })],
    }));
  });

  it("only strikes the title for completed items", () => {
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "real-1", leadingLabel: "$42", title: "Internet", complete: true },
        ]}
        metrics={metrics}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    const meta = chip.querySelector("[data-calendar-chip-meta='true']");
    const title = chip.querySelector("[data-calendar-chip-title-text='true']");

    expect(meta?.closest("s")).toBeNull();
    expect(title?.closest("s")).toBeTruthy();
  });

  it("renders decorative status icons before completed and in-progress deadline chip titles", () => {
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "deadline-done", leadingLabel: "School", title: "Turn in lab", complete: true, statusIcon: "complete" },
          { id: "todo-done", leadingLabel: "Todoist", title: "Submit report", complete: true, statusIcon: "complete" },
          { id: "progress", leadingLabel: "School", title: "Draft essay", statusIcon: "in_progress" },
        ]}
        metrics={{ ...metrics, itemHeight: 36, fullVisibleCount: 3 }}
      />,
    );

    const chips = screen.getAllByTestId("calendar-cell-item-chip");
    const completeIcon = chips[0]!.querySelector("[data-calendar-chip-status-icon='complete']");
    const todoistCompleteIcon = chips[1]!.querySelector("[data-calendar-chip-status-icon='complete']");
    const progressIcon = chips[2]!.querySelector("[data-calendar-chip-status-icon='in_progress']");

    expect(completeIcon).toBeTruthy();
    expect(completeIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(completeIcon?.closest("s")).toBeNull();
    expect(chips[0]!.textContent).toContain("Turn in lab");
    expect(chips[0]!.querySelector("[data-calendar-chip-title-text='true']")?.closest("s")).toBeTruthy();
    expect(todoistCompleteIcon).toBeTruthy();
    expect(todoistCompleteIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(chips[1]!.textContent).toContain("Submit report");
    expect(chips[1]!.querySelector("[data-calendar-chip-title-text='true']")?.closest("s")).toBeTruthy();
    expect(progressIcon).toBeTruthy();
    expect(progressIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(progressIcon?.closest("s")).toBeNull();
    expect(chips[2]!.textContent).toContain("Draft essay");
    expect(chips[2]!.querySelector("[data-calendar-chip-title-text='true']")?.closest("s")).toBeNull();
  });

  it("renders the collapsed overflow trigger when hidden chips exist", () => {
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
          { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
          { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold" },
          { id: "real-4", leadingLabel: "12:00 PM", title: "Fourth hold" },
        ]}
        metrics={metrics}
      />,
    );

    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("opens overflow when the selected item is hidden in the collapsed stack", () => {
    const onOpenOverflow = vi.fn();

    render(
      <CalendarCellItemStack
        day={20}
        dateKey="2026-05-20"
        selectedItemId="hidden-selection"
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
          { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
          { id: "real-3", selectionId: "hidden-selection", leadingLabel: "11:00 AM", title: "Third hold" },
          { id: "real-4", leadingLabel: "12:00 PM", title: "Fourth hold" },
        ]}
        metrics={metrics}
        onOpenOverflow={onOpenOverflow}
      />,
    );

    expect(onOpenOverflow).toHaveBeenCalledWith(expect.objectContaining({
      triggerElement: screen.getByTestId("calendar-cell-overflow-trigger-20"),
      dateKey: "2026-05-20",
      hiddenItems: expect.arrayContaining([
        expect.objectContaining({ id: "real-3" }),
      ]),
    }));
  });

  it("replaces the overflow trigger with inline hidden chips when inline overflow is open", () => {
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
          { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
          { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold" },
          { id: "real-4", leadingLabel: "12:00 PM", title: "Fourth hold" },
        ]}
        metrics={metrics}
        inlineOverflowOpen
      />,
    );

    expect(screen.queryByText("+2 more")).toBeNull();
    expect(screen.getByTestId("calendar-cell-inline-overflow")).toBeTruthy();
    expect(screen.getByText("Third hold").closest("[data-testid='calendar-cell-item-chip']")).toBeTruthy();
    expect(screen.getByText("Fourth hold").closest("[data-testid='calendar-cell-item-chip']")).toBeTruthy();
  });

  it("selects inline hidden chips without closing overflow", () => {
    const onSelectItem = vi.fn();
    const onCloseInlineOverflow = vi.fn();

    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
          { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
          { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold", detailKind: "deadline" },
        ]}
        metrics={metrics}
        onSelectItem={onSelectItem}
        inlineOverflowOpen
        inlineOverflowVisibleCount={2}
        onCloseInlineOverflow={onCloseInlineOverflow}
      />,
    );

    fireEvent.click(screen.getByText("Third hold"));

    expect(onSelectItem).toHaveBeenCalledWith("real-3", expect.objectContaining({
      anchorKind: "overflow-row",
      detailKind: "deadline",
      triggerElement: expect.any(HTMLElement),
    }));
    expect(onCloseInlineOverflow).not.toHaveBeenCalled();
  });

  it("does not move focus into inline overflow when auto focus is disabled", () => {
    const searchInput = document.createElement("input");
    document.body.appendChild(searchInput);
    searchInput.focus();

    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
          { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
          { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold" },
        ]}
        metrics={metrics}
        inlineOverflowOpen
        inlineOverflowAutoFocus={false}
        inlineOverflowVisibleCount={2}
      />,
    );

    expect(document.activeElement).toBe(searchInput);
  });

  it("closes inline overflow when dragging a hidden chip", () => {
    const onCloseInlineOverflow = vi.fn();
    const beginDrag = vi.fn(() => true);
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
    };

    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
          { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
          {
            id: "real-3",
            leadingLabel: "11:00 AM",
            title: "Third hold",
            writable: true,
            sourceEvent: { id: "event-3", title: "Third hold" },
          },
        ]}
        metrics={metrics}
        quickActions={{ dragEnabled: true, beginDrag }}
        inlineOverflowOpen
        inlineOverflowVisibleCount={2}
        onCloseInlineOverflow={onCloseInlineOverflow}
      />,
    );

    fireEvent.dragStart(screen.getByText("Third hold"), { dataTransfer });

    expect(beginDrag).toHaveBeenCalledWith(expect.objectContaining({ id: "event-3" }));
    expect(onCloseInlineOverflow).toHaveBeenCalled();
  });

  it("renders ghost chips as inert preview chips without status labels", () => {
    const onSelectItem = vi.fn();

    render(
      <CalendarCellItemStack
        day={20}
        items={[
          {
            id: "ghost-1",
            isGhost: true,
            ghostKind: "event",
            leadingLabel: "9:00 AM",
            title: "Planning block",
            accent: "#4285f4",
          },
        ]}
        metrics={{ ...metrics, itemHeight: 36 }}
        onSelectItem={onSelectItem}
      />,
    );

    const chip = screen.getByTestId("calendar-ghost-chip");
    const meta = chip.querySelector("[data-calendar-chip-meta='true']");
    expect(chip.tagName).toBe("DIV");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.getAttribute("data-ghost-kind")).toBe("event");
    expect(meta?.textContent).toContain("9a");
    expect(chip.textContent).not.toMatch(/draft|conflict|repeat/i);
    fireEvent.click(chip);
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  describe("chip render stability (PERF-02)", () => {
    // `ItemChip` is exported as `React.memo(...)`; its render function lives
    // at `ItemChip.type`. Swapping that in and out around a render lets us
    // count real render-function invocations without touching production
    // code, while leaving memo's own prop-comparison bailout untouched.
    function spyOnItemChipRenders() {
      const mutableItemChip = ItemChip as unknown as {
        type: (props: ComponentProps<typeof ItemChip>) => ReactNode;
      };
      const originalType = mutableItemChip.type;
      let renderCount = 0;
      mutableItemChip.type = (props: ComponentProps<typeof ItemChip>) => {
        renderCount += 1;
        return originalType(props);
      };
      return {
        count: () => renderCount,
        restore: () => {
          mutableItemChip.type = originalType;
        },
      };
    }

    it("does not re-render chips when the stack rerenders with referentially identical props", () => {
      const spy = spyOnItemChipRenders();
      try {
        const items = [
          { id: "item-1", leadingLabel: "9:00 AM", title: "First" },
          { id: "item-2", leadingLabel: "10:00 AM", title: "Second" },
          { id: "item-3", leadingLabel: "11:00 AM", title: "Third" },
        ];
        const props = {
          day: 20,
          dateKey: "2026-05-20",
          items,
          selectedItemId: null,
          onSelectItem: vi.fn(),
          onBeforeItemAction: vi.fn(),
          metrics: { ...metrics, fullVisibleCount: 3 },
        };

        const { rerender } = render(<CalendarCellItemStack {...props} />);
        expect(screen.getAllByTestId("calendar-cell-item-chip")).toHaveLength(3);
        const initialCount = spy.count();
        expect(initialCount).toBe(3);

        rerender(<CalendarCellItemStack {...props} />);

        expect(spy.count()).toBe(initialCount);
      } finally {
        spy.restore();
      }
    });

    it("only re-renders the chip whose selection actually changed", () => {
      const spy = spyOnItemChipRenders();
      try {
        const items = [
          { id: "item-1", leadingLabel: "9:00 AM", title: "First" },
          { id: "item-2", leadingLabel: "10:00 AM", title: "Second" },
          { id: "item-3", leadingLabel: "11:00 AM", title: "Third" },
        ];
        const baseProps = {
          day: 20,
          dateKey: "2026-05-20",
          items,
          onSelectItem: vi.fn(),
          onBeforeItemAction: vi.fn(),
          metrics: { ...metrics, fullVisibleCount: 3 },
        };

        const { rerender } = render(
          <CalendarCellItemStack {...baseProps} selectedItemId={null} />,
        );
        const initialCount = spy.count();
        expect(initialCount).toBe(3);

        rerender(<CalendarCellItemStack {...baseProps} selectedItemId="item-2" />);

        expect(spy.count()).toBe(initialCount + 1);
      } finally {
        spy.restore();
      }
    });

    it("keeps inline-overflow chip handlers stable across unrelated stack rerenders", () => {
      const spy = spyOnItemChipRenders();
      try {
        const items = [
          { id: "visible-1", leadingLabel: "9:00 AM", title: "Visible" },
          { id: "hidden-1", leadingLabel: "10:00 AM", title: "Hidden one" },
          { id: "hidden-2", leadingLabel: "11:00 AM", title: "Hidden two" },
        ];
        const props = {
          day: 20,
          dateKey: "2026-05-20",
          items,
          metrics: { ...metrics, fullVisibleCount: 1, overflowVisibleCount: 2 },
          inlineOverflowOpen: true,
          inlineOverflowVisibleCount: 2,
          onCloseInlineOverflow: vi.fn(),
          onBeforeItemAction: vi.fn(),
        };

        const { rerender } = render(<CalendarCellItemStack {...props} />);
        const initialCount = spy.count();
        expect(initialCount).toBeGreaterThan(0);

        rerender(<CalendarCellItemStack {...props} />);

        expect(spy.count()).toBe(initialCount);
      } finally {
        spy.restore();
      }
    });
  });

});
