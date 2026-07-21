import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

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

    fireEvent.click(chips[0]!);
    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
    expect(screen.getAllByTestId("calendar-selected-event-title").some((node) => (
      node.textContent?.includes("Design review")
    ))).toBe(true);

    fireEvent.click(chips[1]!);

    await waitFor(() => {
      expect(screen.getAllByTestId("calendar-floating-detail-panel")).toHaveLength(1);
      expect(screen.getByTestId("calendar-floating-detail-panel")).toBe(panel);
      expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain("Budget sync");
    });
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
          getEvents: () => Array.from({ length: 7 }, (_, index) => ({
            id: `event-${index + 1}`,
            title: `Overflow event ${index + 1}`,
            startMs: new Date(`2026-04-20T${String(10 + index).padStart(2, "0")}:00:00.000Z`).getTime(),
            endMs: new Date(`2026-04-20T${String(11 + index).padStart(2, "0")}:00:00.000Z`).getTime(),
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
    } as DOMRect);
    overflowTrigger.getBoundingClientRect = () => ({
      top: 140,
      bottom: 168,
      left: 240,
      right: 380,
      width: 140,
      height: 28,
    } as DOMRect);
    fireEvent.click(overflowTrigger);
    const inlineOverflow = await screen.findByTestId("calendar-cell-inline-overflow");
    const overflowItem = within(inlineOverflow).getAllByTestId("calendar-cell-item-chip")[0]!;

    fireEvent.click(overflowItem);

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(screen.getByTestId("calendar-cell-inline-overflow")).toBeTruthy();
    expect(panel.getAttribute("data-anchor-kind")).toBe("overflow-row");
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain(overflowItem.textContent?.match(/Overflow event \d/)?.[0] || "Overflow event");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(screen.getByTestId("calendar-modal-panel").getAttribute("data-calendar-suppress-focus-ring")).toBe("true");
    expect(screen.getByTestId("calendar-cell-inline-overflow")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-cell-inline-overflow")).toBeNull();
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
          getEvents: () => Array.from({ length: 7 }, (_, index) => ({
            id: `event-${index + 1}`,
            title: `Inline overflow event ${index + 1}`,
            startMs: new Date(`2026-04-20T${String(10 + index).padStart(2, "0")}:00:00.000Z`).getTime(),
            endMs: new Date(`2026-04-20T${String(11 + index).padStart(2, "0")}:00:00.000Z`).getTime(),
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
    modalPanel.getBoundingClientRect = () => ({ top: 0, bottom: 900, left: 0, right: 1200, width: 1200, height: 900 } as DOMRect);
    const overflowTrigger = await screen.findByTestId("calendar-cell-overflow-trigger-20");
    overflowTrigger.getBoundingClientRect = () => ({ top: 120, bottom: 148, left: 240, right: 380, width: 140, height: 28 } as DOMRect);

    fireEvent.click(overflowTrigger);
    const inlineOverflow = (await screen.findAllByTestId("calendar-cell-inline-overflow"))
      .find((element) => element.getAttribute("data-calendar-inline-overflow-layer") === "true");
    expect(inlineOverflow).toBeTruthy();
    const overflowItems = within(inlineOverflow!).getAllByTestId("calendar-cell-item-chip");
    const overflowItem = overflowItems[overflowItems.length - 1]!;

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
      activeBeforeFlip!.dispatchEvent(flipEvent);
    });

    expect(flipEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(activeBeforeFlip);
    expect(within(panel).getByTestId("calendar-selected-event-title").textContent).toContain(selectedTitle);
    await waitFor(() => {
      expect(panel.getAttribute("data-forced-side")).toMatch(/^(left|right)$/);
      expect(panel.getAttribute("data-side-intent")).toBe("user-flip");
    });
  });

});
