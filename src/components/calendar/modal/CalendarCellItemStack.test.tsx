import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CalendarCellItemStack from "./CalendarCellItemStack";

const metrics = {
  itemHeight: 30,
  moreHeight: 28,
  gap: 4,
  fullVisibleCount: 3,
  overflowVisibleCount: 2,
};

afterEach(cleanup);

describe("CalendarCellItemStack interaction contracts", () => {
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

  it("renders ghost chips as inert previews", () => {
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
      />,
    );

    const chip = screen.getByTestId("calendar-ghost-chip");
    expect(chip.tagName).toBe("DIV");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });
});
