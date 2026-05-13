import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.js";
import CalendarModal from "./CalendarModal.jsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.jsx";

describe("CalendarModal floating detail behavior", () => {
  it("opens a floating selected-event detail from chips and reuses the shell for another chip", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: () => ([
            {
              id: "event-1",
              title: "Design review",
              startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
            {
              id: "event-2",
              title: "Budget sync",
              startMs: new Date("2026-04-20T19:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T20:00:00.000Z").getTime(),
              allDay: false,
              color: "#89b4fa",
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const dayCell = screen.getByTestId("calendar-cell-20");
    const chips = within(dayCell).getAllByTestId("calendar-cell-item-chip");

    fireEvent.click(chips[0]);
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
    expect(screen.getAllByTestId("calendar-selected-event-title").some((node) => (
      node.textContent?.includes("Design review")
    ))).toBe(true);

    fireEvent.click(chips[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId("calendar-floating-detail-panel")).toHaveLength(1);
      expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
      expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Budget sync");
    });
  });

  it("keeps the floating detail open when clicking the same selected chip", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: () => ([
            {
              id: "event-1",
              title: "Design review",
              startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const chip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    const panel = await screen.findByTestId("calendar-floating-detail-panel");

    fireEvent.click(chip);

    expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
  });

  it("keeps overflow open while a selected overflow item opens floating detail, then Escape closes detail first", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: () => Array.from({ length: 5 }, (_, index) => ({
            id: `event-${index + 1}`,
            title: `Overflow event ${index + 1}`,
            startMs: new Date(`2026-04-20T${String(15 + index).padStart(2, "0")}:00:00.000Z`).getTime(),
            endMs: new Date(`2026-04-20T${String(16 + index).padStart(2, "0")}:00:00.000Z`).getTime(),
            allDay: false,
            color: "#4285f4",
            writable: true,
          })),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const overflowTrigger = await screen.findByTestId("calendar-cell-overflow-trigger-20");
    fireEvent.click(overflowTrigger);
    const popover = await screen.findByTestId("calendar-cell-overflow-popover");
    const overflowItem = within(popover).getAllByTestId("calendar-cell-overflow-item")[0];

    fireEvent.click(overflowItem);

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(screen.getByTestId("calendar-cell-overflow-popover")).toBe(popover);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain(overflowItem.textContent?.match(/Overflow event \d/)?.[0] || "Overflow event");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(screen.getByTestId("calendar-modal-panel").getAttribute("data-calendar-suppress-focus-ring")).toBe("true");
    expect(screen.getByTestId("calendar-cell-overflow-popover")).toBe(popover);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-overflow-popover")).toBeNull();
    });
  });

  it("keeps a parked floating detail visible beyond the adjacent month data window", async () => {
    window.innerWidth = 1900;
    const aprilEvent = {
      id: "event-1",
      title: "Design review",
      startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
      allDay: false,
      color: "#4285f4",
      writable: true,
    };
    const juneEvent = {
      id: "event-june-20",
      title: "Unrelated June hold",
      startMs: new Date("2026-06-20T17:00:00.000Z").getTime(),
      endMs: new Date("2026-06-20T18:00:00.000Z").getTime(),
      allDay: false,
      color: "#89b4fa",
      writable: true,
    };

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: (year, month) => {
            if (year === 2026 && month === 3) return [aprilEvent];
            if (year === 2026 && month === 5) return [juneEvent];
            return [];
          },
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip"));
    const panel = await screen.findByTestId("calendar-floating-detail-panel");

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/June\s+2026/i);
      expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
      expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
      expect(within(panel).queryByText("Unrelated June hold")).toBeNull();
    });
  });

  it("does not render floating detail on stacked layouts", async () => {
    window.innerWidth = 1100;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: () => ([
            {
              id: "event-1",
              title: "Design review",
              startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip"));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
  });

  it("remembers a Space-flipped floating detail side only for same-date grid browsing", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-05-01"
        eventsData={{
          getEvents: () => ([
            {
              id: "event-1",
              title: "Design review",
              startMs: new Date("2026-05-01T17:00:00.000Z").getTime(),
              endMs: new Date("2026-05-01T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
            {
              id: "event-2",
              title: "Budget review",
              startMs: new Date("2026-05-01T19:00:00.000Z").getTime(),
              endMs: new Date("2026-05-01T20:00:00.000Z").getTime(),
              allDay: false,
              color: "#34a853",
              writable: true,
            },
            {
              id: "event-3",
              title: "Monday planning",
              startMs: new Date("2026-05-04T17:00:00.000Z").getTime(),
              endMs: new Date("2026-05-04T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#fbbc04",
              writable: true,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const modalPanel = screen.getByTestId("calendar-modal-panel");
    const rail = screen.getByTestId("calendar-modal-rail");
    const fridayCell = screen.getByTestId("calendar-cell-1");
    const mondayCell = screen.getByTestId("calendar-cell-4");
    const fridayChips = within(fridayCell).getAllByTestId("calendar-cell-item-chip");
    const mondayChip = within(mondayCell).getByTestId("calendar-cell-item-chip");
    modalPanel.getBoundingClientRect = () => ({ top: 0, bottom: 720, left: 0, right: 1200, width: 1200, height: 720 });
    rail.getBoundingClientRect = () => ({ top: 60, bottom: 680, left: 900, right: 1180, width: 280, height: 620 });
    fridayCell.getBoundingClientRect = () => ({ top: 180, bottom: 300, left: 620, right: 700, width: 80, height: 120 });
    mondayCell.getBoundingClientRect = () => ({ top: 310, bottom: 390, left: 80, right: 160, width: 80, height: 80 });
    fridayChips[0].getBoundingClientRect = () => ({ top: 200, bottom: 228, left: 640, right: 672, width: 32, height: 28 });
    fridayChips[1].getBoundingClientRect = () => ({ top: 232, bottom: 260, left: 640, right: 672, width: 32, height: 28 });
    mondayChip.getBoundingClientRect = () => ({ top: 330, bottom: 358, left: 100, right: 132, width: 32, height: 28 });

    fireEvent.click(fridayChips[0]);
    const floatingPanel = await screen.findByTestId("calendar-floating-detail-panel");

    const flipEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      fridayChips[0].dispatchEvent(flipEvent);
    });

    expect(flipEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(floatingPanel.getAttribute("data-forced-side")).toMatch(/^(left|right)$/);
      expect(floatingPanel.getAttribute("data-side-intent")).toBe("user-flip");
    });
    const rememberedSide = floatingPanel.getAttribute("data-forced-side");

    act(() => {
      fireEvent.click(fridayChips[1]);
    });

    await waitFor(() => {
      expect(floatingPanel.getAttribute("data-forced-side")).toBe(rememberedSide);
      expect(floatingPanel.getAttribute("data-side-intent")).toBe("user-flip");
    });

    act(() => {
      fireEvent.click(mondayChip);
    });

    await waitFor(() => {
      expect(floatingPanel.hasAttribute("data-forced-side")).toBe(false);
      expect(floatingPanel.getAttribute("data-side-intent")).toBe("auto");
    });

    act(() => {
      fireEvent.click(fridayChips[0]);
    });

    await waitFor(() => {
      expect(floatingPanel.hasAttribute("data-forced-side")).toBe(false);
      expect(floatingPanel.getAttribute("data-side-intent")).toBe("auto");
    });
  });
});
