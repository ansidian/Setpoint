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
    const weather = screen.getByTestId("calendar-cell-weather");

    expect(header.contains(screen.getByTestId("calendar-cell-date-header-2026-04-07"))).toBe(true);
    expect(header.contains(weather)).toBe(true);
    expect(weather.textContent).toBe("83/61");
    expect(weather.getAttribute("aria-label")).toBe("Sunny");
    expect(weather.getAttribute("title")).toBe("Sunny");
  });
});
