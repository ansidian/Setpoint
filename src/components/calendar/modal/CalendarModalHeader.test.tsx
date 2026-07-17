import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../CalendarModal.test-setup.ts";
import CalendarModal from "../CalendarModal.tsx";
import { wrapWithDashboard } from "../CalendarModal.test-utils.tsx";

// billsRangeData with ensureRange makes availableCalendarViews = ["events", "bills"]
const billsRangeData = {
  ensureRange: vi.fn().mockResolvedValue(undefined),
  data: {
    schedules: [],
    recentTransactions: [],
    payeeMap: {},
  },
};

function renderWithBills(view = "events", onViewChange = vi.fn()) {
  window.innerWidth = 1900;
  render(wrapWithDashboard(
    <CalendarModal
      open
      onClose={() => {}}
      view={view}
      onViewChange={onViewChange}
      focusDate="2026-04-20"
      eventsData={{ getEvents: () => [] }}
      billsData={{}}
      billsRangeData={billsRangeData}
      deadlinesData={{}}
    />,
  ));
}

function renderEventsOnly(onViewChange = vi.fn()) {
  window.innerWidth = 1900;
  render(wrapWithDashboard(
    <CalendarModal
      open
      onClose={() => {}}
      view="events"
      onViewChange={onViewChange}
      focusDate="2026-04-20"
      eventsData={{ getEvents: () => [] }}
      billsData={{}}
      // no billsRangeData → availableCalendarViews = ["events"]
      deadlinesData={{}}
    />,
  ));
}

describe("CalendarModalHeader tablist", () => {
  it("exposes a tablist with Events and Bills tabs and a 3 hint when bills is available", () => {
    renderWithBills("events");

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/events/i),
        expect.stringMatching(/bills/i),
      ]),
    );
    expect(screen.getByText("3", { selector: "kbd" })).toBeTruthy();
    expect(screen.queryByText("V", { selector: "kbd" })).toBeNull();
  });

  it("marks the active view tab as selected and inactive as not selected", () => {
    renderWithBills("events");

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    const tabs = within(list).getAllByRole("tab");
    const eventsTab = tabs.find((t) => /events/i.test(t.textContent));
    const billsTab = tabs.find((t) => /bills/i.test(t.textContent));

    expect(eventsTab!.getAttribute("aria-selected")).toBe("true");
    expect(billsTab!.getAttribute("aria-selected")).toBe("false");
  });

  it("calls onViewChange when clicking the inactive tab", () => {
    const onViewChange = vi.fn();
    renderWithBills("events", onViewChange);

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    const billsTab = within(list).getAllByRole("tab").find((t) => /bills/i.test(t.textContent));
    fireEvent.click(billsTab!);

    expect(onViewChange).toHaveBeenCalledWith("bills");
  });

  it("ArrowRight on a focused tab moves selection via onViewChange", () => {
    const onViewChange = vi.fn();
    renderWithBills("events", onViewChange);

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    fireEvent.keyDown(list, { key: "ArrowRight" });

    expect(onViewChange).toHaveBeenCalledWith("bills");
  });

  it("ArrowLeft on a focused tab moves selection via onViewChange", () => {
    const onViewChange = vi.fn();
    renderWithBills("bills", onViewChange);

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    fireEvent.keyDown(list, { key: "ArrowLeft" });

    expect(onViewChange).toHaveBeenCalledWith("events");
  });

  it("Home key moves to first view when not already first", () => {
    const onViewChange = vi.fn();
    renderWithBills("bills", onViewChange);

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    fireEvent.keyDown(list, { key: "Home" });
    expect(onViewChange).toHaveBeenCalledWith("events");
  });

  it("End key moves to last view when not already last", () => {
    const onViewChange = vi.fn();
    renderWithBills("events", onViewChange);

    const list = screen.getByRole("tablist", { name: /calendar view/i });
    fireEvent.keyDown(list, { key: "End" });
    expect(onViewChange).toHaveBeenCalledWith("bills");
  });

  it("does NOT render a tablist when only events view is available", () => {
    renderEventsOnly();

    expect(screen.queryByRole("tablist", { name: /calendar view/i })).toBeNull();
  });
});
