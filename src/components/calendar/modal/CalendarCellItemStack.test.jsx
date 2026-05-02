import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(chip.style.flexDirection).toBe("column");
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

    expect(chips[0].style.flexDirection).toBe("column");
    expect(chips[1].style.flexDirection).toBe("column");
    expect(chips[0].querySelector("[data-calendar-chip-meta='true']")?.textContent).toContain("10:50a");
    expect(shortTitle?.getAttribute("data-calendar-chip-title-fit")).toBe("11/1");
    expect(longTitle?.getAttribute("data-calendar-chip-title-fit")).toBe("10/2");
    expect(longTitle?.style.flex).toBe("0 1 auto");
    expect(longTitle?.style.maxHeight).toBe("21.6px");
    expect(longTitle?.style.overflow).toBe("hidden");
    expect(longTitle?.style.webkitLineClamp).toBe("2");
    expect(longTitle?.style.whiteSpace).toBe("normal");
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

    expect(titles[0]?.style.fontWeight).toBe("500");
    expect(titles[1]?.style.fontWeight).toBe("500");
    expect(titles[0]?.style.maxHeight).toBe(titles[1]?.style.maxHeight);
    expect(titles[0]?.getAttribute("data-calendar-chip-title-fit")).toBe(
      titles[1]?.getAttribute("data-calendar-chip-title-fit"),
    );
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

    expect(meta?.style.textDecoration).toBe("");
    expect(title?.style.textDecoration).toBe("line-through");
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
          { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold" },
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

  it("uses the measured cell height to fit extra chips before showing overflow", async () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.getAttribute?.("data-testid") === "measured-cell-host" ? 130 : 0;
      },
    });

    try {
      render(
        <div data-testid="measured-cell-host">
          <CalendarCellItemStack
            day={20}
            items={[
              { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
              { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
              { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold" },
              { id: "real-4", leadingLabel: "12:00 PM", title: "Fourth hold" },
            ]}
            metrics={metrics}
          />
        </div>,
      );

      await waitFor(() => {
        expect(screen.getAllByTestId("calendar-cell-item-chip")).toHaveLength(3);
        expect(screen.getByText("+1 more")).toBeTruthy();
      });
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      } else {
        delete HTMLElement.prototype.clientHeight;
      }
    }
  });

  it("measures the clipping viewport instead of an expanding frame", async () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.getAttribute?.("data-testid") === "clipping-cell-host") return 100;
        if (this.getAttribute?.("data-testid") === "expanding-selected-frame") return 104;
        return 0;
      },
    });

    try {
      render(
        <div data-testid="clipping-cell-host" style={{ overflow: "hidden" }}>
          <div data-testid="expanding-selected-frame" style={{ overflow: "visible" }}>
            <CalendarCellItemStack
              day={20}
              items={[
                { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
                { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
                { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold" },
              ]}
              metrics={{
                itemHeight: 32,
                moreHeight: 28,
                gap: 4,
                fullVisibleCount: 3,
                overflowVisibleCount: 2,
              }}
            />
          </div>
        </div>,
      );

      await waitFor(() => {
        expect(screen.getAllByTestId("calendar-cell-item-chip")).toHaveLength(2);
        expect(screen.getByText("+1 more")).toBeTruthy();
      });
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      } else {
        delete HTMLElement.prototype.clientHeight;
      }
    }
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

  it("renders ghost chips as inert dotted chips without status labels", () => {
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
        metrics={metrics}
      />,
    );

    const chip = screen.getByTestId("calendar-ghost-chip");
    expect(chip.tagName).toBe("DIV");
    expect(chip.style.pointerEvents).toBe("none");
    expect(chip.style.cursor).toBe("default");
    expect(chip.style.border).toContain("dotted");
    expect(chip.textContent).not.toMatch(/draft|conflict|repeat/i);
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

  it("reserves top-lane space so normal chips overflow before pinned spans", async () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.getAttribute?.("data-testid") === "reserved-lane-host" ? 90 : 0;
      },
    });

    try {
      render(
        <div data-testid="reserved-lane-host">
          <CalendarCellItemStack
            day={20}
            items={[
              { id: "real-1", leadingLabel: "9:00 AM", title: "First hold" },
              { id: "real-2", leadingLabel: "10:00 AM", title: "Second hold" },
              { id: "real-3", leadingLabel: "11:00 AM", title: "Third hold" },
            ]}
            metrics={metrics}
            reservedLaneCount={1}
          />
        </div>,
      );

      await waitFor(() => {
        expect(screen.queryAllByTestId("calendar-cell-item-chip")).toHaveLength(0);
        expect(screen.getByText("+3 more")).toBeTruthy();
      });
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      } else {
        delete HTMLElement.prototype.clientHeight;
      }
    }
  });
});
