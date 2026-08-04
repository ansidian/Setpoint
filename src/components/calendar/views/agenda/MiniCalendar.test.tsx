import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MiniCalendar from "./MiniCalendar.tsx";

afterEach(() => {
  cleanup();
});

describe("MiniCalendar", () => {
  it("renders a stable six-row grid with selected, today, and adjacent date semantics", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
      />,
    );

    expect(screen.getByTestId("calendar-mini-calendar").getAttribute("data-row-count")).toBe("6");
    expect(screen.getAllByTestId("calendar-mini-calendar-date")).toHaveLength(42);
    expect(screen.getByRole("button", { name: /Friday, May 15, today/i }).getAttribute("data-date-tone")).toBe("today");
    expect(screen.getByRole("button", { name: /Wednesday, May 20, selected/i }).getAttribute("data-date-fill")).toBe("selected");
    expect(screen.getByRole("button", { name: /Sunday, April 26/i }).getAttribute("data-adjacent-position")).toBe("leading");
    expect(screen.getByRole("button", { name: /Saturday, June 6/i }).getAttribute("data-adjacent-position")).toBe("trailing");
  });

  it("renders true-color markers with the deadline check after dot markers", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
        activityItems={[
          { id: "event-1", dateKey: "2026-06-01", kind: "event", color: "#89b4fa" },
          { id: "bill-1", dateKey: "2026-06-01", kind: "bill", color: "#f97316" },
          { id: "deadline-1", dateKey: "2026-06-01", kind: "deadline", color: "#a6e3a1" },
        ]}
      />,
    );

    const juneOne = screen.getByRole("button", { name: /Monday, June 1/i });
    expect(juneOne.getAttribute("data-adjacent-position")).toBe("trailing");

    const markers = within(juneOne).getAllByTestId("calendar-mini-calendar-marker");
    expect(markers.map((marker) => marker.getAttribute("data-marker-kind"))).toEqual([
      "dot",
      "dot",
      "deadline",
    ]);
    expect(markers.map((marker) => marker.getAttribute("data-marker-color"))).toEqual([
      "#89b4fa",
      "#f97316",
      "#a6e3a1",
    ]);
  });

  it("renders multi-day all-day hover previews as continuous row segments", () => {
    render(
      <MiniCalendar
        viewYear={2026}
        viewMonth={4}
        todayKey="2026-05-15"
        selectedDateKey="2026-05-20"
        activityItems={[
          { id: "event-1", dateKey: "2026-05-01", kind: "event", color: "#a6e3a1" },
        ]}
        hoverPreviewItem={{
          id: "conference",
          allDay: true,
          startDate: "2026-05-01",
          endDate: "2026-05-10",
          kind: "event",
          color: "#a6e3a1",
        }}
      />,
    );

    const segments = screen.getAllByTestId("calendar-mini-calendar-hover-preview");
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.getAttribute("data-segment-start"))).toEqual([
      "2026-05-01",
      "2026-05-03",
      "2026-05-10",
    ]);
    expect(segments.map((segment) => segment.getAttribute("data-segment-end"))).toEqual([
      "2026-05-02",
      "2026-05-09",
      "2026-05-10",
    ]);
    expect(segments.every((segment) => segment.getAttribute("data-preview-color") === "#a6e3a1")).toBe(true);

    const firstPreviewDate = screen.getByRole("button", { name: "Friday, May 1" });
    const marker = within(firstPreviewDate).getByTestId("calendar-mini-calendar-marker");
    expect(marker.getAttribute("data-marker-contrast-ring")).toBe("dark");
  });

});
