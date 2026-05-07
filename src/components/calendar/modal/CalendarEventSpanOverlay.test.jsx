import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CalendarEventSpanOverlay from "./CalendarEventSpanOverlay.jsx";
import { getChipLeadingColumnWidth } from "./CalendarCellItemChipModel.js";

afterEach(() => {
  cleanup();
});

describe("CalendarEventSpanOverlay", () => {
  it("keeps spanning event ghost chip time labels in a stable leading column", () => {
    render(
      <CalendarEventSpanOverlay
        segments={[{
          id: "ghost:event-1:2026-04-20:2026-04-22",
          kind: "ghost",
          row: 1,
          columnStart: 2,
          columnEnd: 5,
          lane: 0,
          segmentStart: "2026-04-20",
          segmentEnd: "2026-04-22",
          item: {
            id: "event-ghost",
            kind: "event",
            title: "Check-in IHSS",
            startDate: "2026-04-20",
            endDate: "2026-04-22",
            startTime: "13:00",
            color: "#89b4fa",
          },
        }]}
        layout={{ cellHeight: 120, gridGap: 4, tier: "lg" }}
        gridRowCount={6}
      />,
    );

    const ghost = screen.getByTestId("calendar-ghost-chip");
    const meta = ghost.querySelector("[data-calendar-span-meta='true']");
    const content = ghost.querySelector("[data-calendar-span-title-fit]");

    expect(meta?.textContent).toContain("1p");
    expect(meta?.style.width).toBe(`${getChipLeadingColumnWidth([{ leadingLabel: "1:00 PM" }])}px`);
    expect(content?.style.gridTemplateColumns).toBe(`${meta?.style.width} minmax(0, 1fr)`);
    expect(ghost.querySelector("[data-calendar-span-title-text='true']")?.textContent).toBe("Check-in IHSS");
  });
});
