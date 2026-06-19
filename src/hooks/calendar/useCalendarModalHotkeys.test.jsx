import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../../components/calendar/CalendarModal.test-setup.js";
import CalendarModal from "../../components/calendar/CalendarModal.jsx";
import { wrapWithDashboard } from "../../components/calendar/CalendarModal.test-utils.jsx";

// Thin integration tests for the v/Shift+V view-cycle hotkey binding.
// We fire real keydown events against a mounted CalendarModal and assert on
// onViewChange — the observable output of the hotkey path.

function renderModal({ view = "events", billsRangeData, onViewChange } = {}) {
  window.innerWidth = 1900;
  render(wrapWithDashboard(
    <CalendarModal
      open
      onClose={() => {}}
      view={view}
      onViewChange={onViewChange ?? (() => {})}
      focusDate="2026-04-20"
      eventsData={{ getEvents: () => [] }}
      billsData={{}}
      billsRangeData={billsRangeData}
      deadlinesData={{}}
    />,
  ));
}

describe("useCalendarModalHotkeys — v/V view cycling", () => {
  it("pressing v cycles from events → bills when bills is available", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    fireEvent.keyDown(document, { key: "v" });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("bills");
  });

  it("pressing v again (from bills) cycles back to events", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "bills", billsRangeData: { ensureRange: vi.fn().mockResolvedValue(null) }, onViewChange });

    fireEvent.keyDown(document, { key: "v" });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("events");
  });

  it("pressing Shift+V cycles in reverse (bills → events)", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "bills", billsRangeData: { ensureRange: vi.fn().mockResolvedValue(null) }, onViewChange });

    fireEvent.keyDown(document, { key: "V", shiftKey: true });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("events");
  });

  it("pressing plain 1 does NOT cycle the view", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    fireEvent.keyDown(document, { key: "1" });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("pressing Cmd+1 does NOT cycle the view", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    fireEvent.keyDown(document, { key: "1", metaKey: true });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("pressing Ctrl+1 does NOT cycle the view", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    fireEvent.keyDown(document, { key: "1", ctrlKey: true });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("v does not cycle when bills view is unavailable (no ensureRange)", () => {
    const onViewChange = vi.fn();
    // No billsRangeData → availableCalendarViews = ["events"] → no-op cycle
    renderModal({ view: "events", onViewChange });

    fireEvent.keyDown(document, { key: "v" });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("does not consume 1/2/3 so the shell tab hotkeys still receive them", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    // The calendar's document-capture hotkey listener must let the shell tab keys
    // (1=dashboard, 2=inbox, 3=calendar) bubble: it neither cycles the view nor
    // calls preventDefault, so the event reaches the shell handler.
    for (const key of ["1", "2", "3"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("v does NOT cycle when focus is inside a suspended hotkey target", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    // Simulate focus inside a search rail or any suspended container.
    const rail = document.createElement("div");
    rail.setAttribute("data-suspend-calendar-hotkeys", "true");
    const input = document.createElement("input");
    rail.appendChild(input);
    document.body.appendChild(rail);

    fireEvent.keyDown(input, { key: "v", bubbles: true });

    expect(onViewChange).not.toHaveBeenCalled();

    rail.remove();
  });
});
