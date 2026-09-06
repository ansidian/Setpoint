import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { getLatestRailContent, wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal event grid behavior", () => {
  it("keeps the selected event when clicking its selected day cell again", async () => {
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

    const dayCell = await screen.findByTestId("calendar-cell-20", {}, { timeout: 5000 });
    fireEvent.click(within(dayCell).getByTestId("calendar-cell-item-chip"));
    expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");

    fireEvent.click(dayCell);

    expect(within(screen.getByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-event-title").textContent).toContain("Design review");
    expect(getLatestRailContent().getAttribute("data-rail-content-kind")).toBe("agenda");
  });

  it("builds and clears a Calendar Event Selection Set from modifier-clicked grid chips", async () => {
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
              accountId: "gmail-main",
              calendarId: "primary",
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

    const eventCell = await screen.findByTestId("calendar-cell-20", {}, { timeout: 5000 });
    const chip = within(eventCell).getByTestId("calendar-cell-item-chip");

    fireEvent.click(chip, { metaKey: true });

    await waitFor(() => {
      expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");
    });
    expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("calendar-cell-21"), { metaKey: true });
    expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");

    fireEvent.click(screen.getByTestId("calendar-cell-21"));

    await waitFor(() => {
      expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();
    });
  });

  it("promotes the focused event into the selection set on bare Meta", async () => {
    window.innerWidth = 1900;
    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{
          getEvents: () => ([{
            id: "event-1",
            title: "Design review",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
            endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
            allDay: false,
            color: "#4285f4",
            writable: true,
          }]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));
    const chip = within(await screen.findByTestId("calendar-cell-20", {}, { timeout: 5000 })).getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Meta" });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
      expect(chip.getAttribute("data-calendar-event-selection")).toBe("true");
    });
  });

  it("dismisses an identity-less birthday detail on bare Control without touching the selection set", async () => {
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
              accountId: "gmail-main",
              calendarId: "primary",
              startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
              endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
              allDay: false,
              color: "#4285f4",
              writable: true,
            },
            {
              id: "birthday-1",
              title: "Maya's birthday",
              accountId: "gmail-main",
              calendarId: "primary",
              eventType: "birthday",
              startMs: new Date("2026-04-21T07:00:00.000Z").getTime(),
              endMs: new Date("2026-04-22T07:00:00.000Z").getTime(),
              allDay: true,
              writable: false,
            },
          ]),
        }}
        billsData={{}}
        deadlinesData={{}}
      />,
    ));

    const chip = within(await screen.findByTestId("calendar-cell-20", {}, { timeout: 5000 })).getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    const birthdaySpan = screen.getByTestId("calendar-event-span-segment");
    expect(birthdaySpan.textContent).toContain("Maya's birthday");
    fireEvent.click(birthdaySpan);
    expect(within(await screen.findByTestId("calendar-floating-detail-panel")).getByTestId("calendar-selected-event-title").textContent).toContain("Maya's birthday");

    fireEvent.keyDown(document, { key: "Control" });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
    expect(birthdaySpan.getAttribute("data-calendar-event-selection")).toBeNull();
    expect(chip.getAttribute("data-calendar-event-selection")).toBeNull();
  });

  it("consumes navigation hotkeys without leaving selected items in focus-ring mode", async () => {
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

    const panel = await screen.findByTestId("calendar-modal-panel", {}, { timeout: 5000 });
    const chip = within(await screen.findByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    chip.focus();

    const navigationEvent = new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true });
    act(() => {
      chip.dispatchEvent(navigationEvent);
    });

    expect(navigationEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(panel.getAttribute("data-calendar-suppress-focus-ring")).toBe("true");
    });

    const strayHotkeyEvent = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(strayHotkeyEvent);
    });

    expect(strayHotkeyEvent.defaultPrevented).toBe(true);

    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(tabEvent);
    });

    await waitFor(() => {
      expect(panel.hasAttribute("data-calendar-suppress-focus-ring")).toBe(false);
    });
  });
});
