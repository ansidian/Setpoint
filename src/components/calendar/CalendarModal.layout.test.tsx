import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal accessibility", () => {
  it("exposes the seven named weekday column headers", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const weekdayHeaders = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
      .map((name) => screen.getByRole("columnheader", { name }));
    expect(weekdayHeaders).toHaveLength(7);
  });
});
