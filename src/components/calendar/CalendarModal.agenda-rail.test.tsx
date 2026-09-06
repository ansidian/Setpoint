import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal agenda rail state behavior", () => {
  it("closes a completed deadline floating detail when completed agenda rows are hidden", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="deadline:deadline-1:2026-04-20"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [
            { id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "complete" },
          ],
        }}
      />,
    ));

    expect(await screen.findByTestId("calendar-floating-detail-panel", {}, { timeout: 5000 })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /hide completed deadlines/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(within(screen.getByTestId("events-agenda-rail")).queryByText("Project due")).toBeNull();
    expect(within(screen.getByTestId("calendar-cell-20")).queryByText("Project due")).toBeNull();
  });

});
