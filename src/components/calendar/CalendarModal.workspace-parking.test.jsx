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
    screen.getByTestId("calendar-modal-panel").getBoundingClientRect = () => ({
      top: 0,
      bottom: 160,
      left: 0,
      right: 1200,
      width: 1200,
      height: 160,
    });
    overflowTrigger.getBoundingClientRect = () => ({
      top: 140,
      bottom: 168,
      left: 240,
      right: 380,
      width: 140,
      height: 28,
    });
    fireEvent.click(overflowTrigger);
    const popover = await screen.findByTestId("calendar-cell-overflow-popover");
    const overflowItem = within(popover).getAllByTestId("calendar-cell-overflow-item")[0];

    fireEvent.click(overflowItem);

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(screen.getByTestId("calendar-cell-overflow-popover")).toBe(popover);
    expect(panel.getAttribute("data-anchor-kind")).toBe("overflow-row");
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

  it("flips a selected inline-overflow detail side with Space without changing the selected item", async () => {
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
            title: `Inline overflow event ${index + 1}`,
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

    const modalPanel = screen.getByTestId("calendar-modal-panel");
    modalPanel.getBoundingClientRect = () => ({ top: 0, bottom: 900, left: 0, right: 1200, width: 1200, height: 900 });
    const overflowTrigger = await screen.findByTestId("calendar-cell-overflow-trigger-20");
    overflowTrigger.getBoundingClientRect = () => ({ top: 120, bottom: 148, left: 240, right: 380, width: 140, height: 28 });

    fireEvent.click(overflowTrigger);
    const inlineOverflow = (await screen.findAllByTestId("calendar-cell-inline-overflow"))
      .find((element) => element.getAttribute("data-calendar-inline-overflow-layer") === "true");
    expect(inlineOverflow).toBeTruthy();
    const overflowItems = within(inlineOverflow).getAllByTestId("calendar-cell-item-chip");
    const overflowItem = overflowItems[overflowItems.length - 1];

    fireEvent.click(overflowItem);

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    const selectedTitle = overflowItem.textContent?.match(/Inline overflow event \d/)?.[0] || "Inline overflow event";
    expect(screen.queryByTestId("calendar-cell-overflow-popover")).toBeNull();
    expect(
      (await screen.findAllByTestId("calendar-cell-inline-overflow"))
        .some((element) => element.getAttribute("data-calendar-inline-overflow-layer") === "true"
          && element.textContent?.includes(selectedTitle)),
    ).toBe(true);
    const activeBeforeFlip = document.activeElement;
    expect(panel.getAttribute("data-anchor-kind")).toBe("overflow-row");
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain(selectedTitle);

    const flipEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      activeBeforeFlip.dispatchEvent(flipEvent);
    });

    expect(flipEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(activeBeforeFlip);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain(selectedTitle);
    await waitFor(() => {
      expect(panel.getAttribute("data-forced-side")).toMatch(/^(left|right)$/);
      expect(panel.getAttribute("data-side-intent")).toBe("user-flip");
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

  it("reanchors a parked birthday detail when its month returns", async () => {
    window.innerWidth = 1900;
    const birthday = {
      id: "birthday-1",
      title: "Maya's birthday",
      eventType: "birthday",
      birthdayProperties: { type: "birthday" },
      startMs: new Date("2026-04-20T07:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T07:00:00.000Z").getTime(),
      allDay: true,
      sourceLabel: "Birthdays",
      color: "#ff887c",
      writable: false,
    };

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: (year, month) => (year === 2026 && month === 3 ? [birthday] : []),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    fireEvent.click(await screen.findByTestId("calendar-event-span-segment"), { clientX: 4 });
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-anchor-kind")).toBe("span");

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May\s+2026/i);
      expect(panel.getAttribute("data-anchor-kind")).toBe("parked");
      expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Maya's birthday");
    });

    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/April\s+2026/i);
      expect(panel.getAttribute("data-anchor-kind")).toBe("chip");
      expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Maya's birthday");
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

});
