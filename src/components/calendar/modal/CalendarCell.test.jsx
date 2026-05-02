import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CalendarCell from "./CalendarCell.jsx";

afterEach(() => {
  cleanup();
});

describe("CalendarCell", () => {
  it("renders weather inline with the date header", () => {
    render(
      <CalendarCell
        view="events"
        viewYear={2026}
        viewMonth={3}
        viewLabel="Events"
        day={7}
        dateKey="2026-04-07"
        dateLabel="7"
        items={[]}
        ghosts={[]}
        cellMeta={{
          weather: {
            dateKey: "2026-04-07",
            high: 83,
            low: 61,
            icon: "Sun",
            summary: "Sunny",
          },
        }}
        itemCount={0}
        hasItems={false}
        isToday={false}
        isSelected={false}
        renderCellContents={() => null}
      />,
    );

    const header = screen.getByTestId("calendar-cell-header");
    expect(header.contains(screen.getByTestId("calendar-cell-date-header-2026-04-07"))).toBe(true);
    expect(screen.getByTestId("calendar-cell-weather").textContent).toBe("83/61");
    expect(screen.getByTestId("calendar-cell-weather").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("calendar-cell-weather").style.color).toBe("rgba(205, 214, 244, 0.48)");
    expect(screen.getByTestId("calendar-cell-weather").getAttribute("title")).toBe("Sunny");
  });
});
