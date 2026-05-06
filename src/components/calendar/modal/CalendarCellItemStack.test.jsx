import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarCellItemStack from "./CalendarCellItemStack.jsx";

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

  it("uses two readable title lines with a compact run-in prefix for long month chips", () => {
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "short", leadingLabel: "10:50 AM", title: "Sync" },
          { id: "long", leadingLabel: "11:30 AM", title: "Advanced machine learning project review and lab planning" },
        ]}
        metrics={{ ...metrics, itemHeight: 36, fullVisibleCount: 2 }}
      />,
    );

    const chips = screen.getAllByTestId("calendar-cell-item-chip");
    const shortTitle = chips[0].querySelector("[data-calendar-chip-title='true']");
    const longTitle = chips[1].querySelector("[data-calendar-chip-title='true']");

    expect(chips[0].querySelector("[data-calendar-chip-meta='true']")?.textContent).toContain("10:50a");
    expect(shortTitle?.getAttribute("data-calendar-chip-title-fit")).toBe("11/1");
    expect(longTitle?.getAttribute("data-calendar-chip-title-fit")).toBe("10/2");
    expect(longTitle?.textContent).toContain("Advanced machine learning project review");
  });

  it("keeps selected chip title metrics stable", () => {
    render(
      <CalendarCellItemStack
        day={20}
        selectedItemId="selected"
        items={[
          { id: "plain", leadingLabel: "Todoist", title: "Chase Prime Visa $15 statement credit deadline" },
          { id: "selected", leadingLabel: "Todoist", title: "Chase Prime Visa $15 statement credit deadline" },
        ]}
        metrics={{ ...metrics, itemHeight: 36, fullVisibleCount: 2 }}
      />,
    );

    const titles = screen
      .getAllByTestId("calendar-cell-item-chip")
      .map((chip) => chip.querySelector("[data-calendar-chip-title='true']"));

    expect(titles[0]?.getAttribute("data-calendar-chip-title-fit")).toBe(
      titles[1]?.getAttribute("data-calendar-chip-title-fit"),
    );
  });

  it("uses stable layout identity and selection aliases for occurrence-backed chips", () => {
    const onSelectItem = vi.fn();
    render(
      <CalendarCellItemStack
        day={20}
        selectedItemId="schedule-1"
        items={[
          {
            id: "schedule-1:2026-05-10",
            renderKey: "bill:schedule-1",
            layoutId: "calendar-bill-chip:schedule-1",
            matchItemIds: ["schedule-1:2026-05-10", "schedule-1"],
            leadingLabel: "$42",
            title: "Internet",
          },
        ]}
        metrics={metrics}
        onSelectItem={onSelectItem}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.getAttribute("data-item-id")).toBe("schedule-1:2026-05-10");
    expect(chip.getAttribute("data-calendar-layout-id")).toBe("calendar-bill-chip:schedule-1");
    expect(chip.style.border).toContain("color-mix");
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

  it("keeps occurrence-backed chip layout identity stable when the due date changes", () => {
    const { rerender } = render(
      <CalendarCellItemStack
        day={10}
        items={[
          {
            id: "schedule-1:2026-05-10",
            renderKey: "bill:schedule-1",
            layoutId: "calendar-bill-chip:schedule-1",
            leadingLabel: "$42",
            title: "Internet",
          },
        ]}
        metrics={metrics}
      />,
    );

    expect(screen.getByTestId("calendar-cell-item-chip").getAttribute("data-calendar-layout-id")).toBe(
      "calendar-bill-chip:schedule-1",
    );

    rerender(
      <CalendarCellItemStack
        day={12}
        items={[
          {
            id: "schedule-1:2026-05-12",
            renderKey: "bill:schedule-1",
            layoutId: "calendar-bill-chip:schedule-1",
            leadingLabel: "$42",
            title: "Internet",
          },
        ]}
        metrics={metrics}
      />,
    );

    const chip = screen.getByTestId("calendar-cell-item-chip");
    expect(chip.getAttribute("data-item-id")).toBe("schedule-1:2026-05-12");
    expect(chip.getAttribute("data-calendar-layout-id")).toBe("calendar-bill-chip:schedule-1");
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
          { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold", detailView: "deadlines" },
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
      detailView: "deadlines",
      triggerElement: expect.any(HTMLElement),
    }));
    expect(onCloseInlineOverflow).not.toHaveBeenCalled();
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

  it("promotes a hidden ghost into the visible stack and overflows displaced real items", () => {
    const onOpenOverflow = vi.fn();
    render(
      <CalendarCellItemStack
        day={20}
        dateKey="2026-04-20"
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "Earlier hold" },
          { id: "real-2", leadingLabel: "10:00 AM", title: "Visible hold" },
          { id: "real-3", leadingLabel: "11:00 AM", title: "Later hold" },
          {
            id: "ghost-1",
            isGhost: true,
            ghostKind: "event",
            ghostStart: "2026-04-20",
            ghostEnd: "2026-04-20",
            leadingLabel: "12:30 PM",
            title: "Preview hold",
            accent: "#4285f4",
          },
        ]}
        metrics={metrics}
        onOpenOverflow={onOpenOverflow}
      />,
    );

    expect(screen.getByTestId("calendar-ghost-chip").textContent).toContain("12:30p");
    expect(screen.getByTestId("calendar-ghost-chip").textContent).toContain("Preview hold");
    expect(screen.getByText("+2 more")).toBeTruthy();
    expect(screen.queryByText("Visible hold")).toBeNull();

    fireEvent.click(screen.getByText("+2 more"));
    expect(onOpenOverflow).toHaveBeenCalledWith(expect.objectContaining({
      hiddenItems: expect.arrayContaining([
        expect.objectContaining({ id: "real-2" }),
        expect.objectContaining({ id: "real-3" }),
      ]),
      totalCount: 4,
      visibleCount: 2,
    }));
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
    const title = chip.querySelector("[data-calendar-chip-title='true']");
    expect(chip.tagName).toBe("DIV");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.getAttribute("data-ghost-kind")).toBe("event");
    expect(meta?.textContent).toContain("9a");
    expect(title?.getAttribute("data-calendar-chip-title-fit")).toBe("11/1");
    expect(chip.textContent).not.toMatch(/draft|conflict|repeat/i);
    fireEvent.click(chip);
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it("keeps a ghost visible even when compact overflow capacity would hide all chips", () => {
    render(
      <CalendarCellItemStack
        day={20}
        items={[
          { id: "real-1", leadingLabel: "9:00 AM", title: "Earlier hold" },
          {
            id: "ghost-1",
            isGhost: true,
            ghostKind: "event",
            leadingLabel: "10:00 AM",
            title: "Planning block",
            accent: "#4285f4",
          },
        ]}
        metrics={{
          itemHeight: 28,
          moreHeight: 26,
          gap: 4,
          fullVisibleCount: 1,
          overflowVisibleCount: 0,
        }}
      />,
    );

    expect(screen.getByTestId("calendar-ghost-chip").textContent).toContain("Planning block");
    expect(screen.getByText("+1 more")).toBeTruthy();
    expect(screen.queryByText("Earlier hold")).toBeNull();
  });

});
