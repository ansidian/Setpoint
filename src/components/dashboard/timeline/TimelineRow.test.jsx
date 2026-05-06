import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TimelineRow from "./TimelineRow.jsx";

describe("TimelineRow", () => {
  it("renders all-day events as all-day rather than timed live blocks", () => {
    const now = new Date("2026-05-05T20:25:00.000Z").getTime();
    const allDayEvent = {
      kind: "event",
      startMs: new Date("2026-05-05T12:00:00.000Z").getTime(),
      endMs: new Date("2026-05-06T12:00:00.000Z").getTime(),
      data: {
        id: "cinco",
        title: "Cinco de Mayo",
        allDay: true,
        startMs: new Date("2026-05-05T12:00:00.000Z").getTime(),
        endMs: new Date("2026-05-06T12:00:00.000Z").getTime(),
      },
    };

    render(<TimelineRow accent="#cba6da" item={allDayEvent} now={now} />);

    expect(screen.getByText("All day")).toBeTruthy();
    expect(screen.queryByText("5:00 am")).toBeNull();
    expect(screen.queryByText("24h")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
  });
});
