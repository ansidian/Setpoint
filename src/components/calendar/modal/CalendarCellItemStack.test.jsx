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

    expect(screen.getByTestId("calendar-ghost-chip").textContent).toContain("12:30 PM");
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
});
