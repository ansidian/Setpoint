import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../../components/calendar/CalendarModal.test-setup.js";
import CalendarModal from "../../components/calendar/CalendarModal.jsx";
import { wrapWithDashboard } from "../../components/calendar/CalendarModal.test-utils.jsx";

// Thin integration tests for the 3-key view-cycle hotkey binding (re-pressing
// the calendar's own shell-tab key toggles events/bills; v is retired).
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

describe("useCalendarModalHotkeys — 3-key view cycling", () => {
  it("pressing 3 cycles from events → bills when bills is available", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    fireEvent.keyDown(document, { key: "3" });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("bills");
  });

  it("pressing 3 again (from bills) cycles back to events", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "bills", billsRangeData: { ensureRange: vi.fn().mockResolvedValue(null) }, onViewChange });

    fireEvent.keyDown(document, { key: "3" });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("events");
  });

  it("pressing v does NOT cycle the view (v is retired)", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    fireEvent.keyDown(document, { key: "v" });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("pressing Shift+V does NOT cycle the view (v is retired)", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "bills", billsRangeData: { ensureRange: vi.fn().mockResolvedValue(null) }, onViewChange });

    fireEvent.keyDown(document, { key: "V", shiftKey: true });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("Cmd+3 and Ctrl+3 do NOT cycle the view and still bubble", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    // Browser tab-switch combos must pass through untouched.
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = new KeyboardEvent("keydown", { key: "3", ...modifier, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(onViewChange).not.toHaveBeenCalled();
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

  it("3 does not cycle when bills view is unavailable (no ensureRange)", () => {
    const onViewChange = vi.fn();
    // No billsRangeData → availableCalendarViews = ["events"] → no-op cycle
    renderModal({ view: "events", onViewChange });

    fireEvent.keyDown(document, { key: "3" });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("does not consume 1/2/4 so the shell tab hotkeys still receive them", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    // The calendar's document-capture hotkey listener must let the OTHER shell
    // tab keys (1=dashboard, 2=inbox, 4=notes) bubble: it neither cycles the
    // view nor calls preventDefault, so the event reaches the shell handler.
    for (const key of ["1", "2", "4"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("consumes 3 (the calendar's own tab key) so it never reaches the shell tab handler", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    const event = new KeyboardEvent("keydown", { key: "3", bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onViewChange).toHaveBeenCalledWith("bills");
  });

  it("suspends all calendar hotkeys while a blocking shell overlay is open", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    // Simulate an open blocking overlay (Analytics / briefing History) mounted
    // anywhere in the DOM. History never traps focus, so the keydown target is
    // the body — the calendar must stay inert on PRESENCE of the marker alone:
    // no view cycle, and the key is left unconsumed.
    const overlay = document.createElement("div");
    overlay.setAttribute("data-suspend-calendar-hotkeys", "blocking");
    document.body.appendChild(overlay);

    // "t" is normally always consumed (today reset) — asserting BOTH keys pass
    // through unprevented pins the guard ahead of the whole switch, not just
    // the view-cycle case.
    for (const key of ["3", "t"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onViewChange).not.toHaveBeenCalled();

    overlay.remove();
  });

  it("3 does NOT cycle when focus is inside a suspended hotkey target", () => {
    const onViewChange = vi.fn();
    renderModal({ view: "events", billsRangeData: { ensureRange: vi.fn() }, onViewChange });

    // Simulate focus inside a search rail or any suspended container.
    const rail = document.createElement("div");
    rail.setAttribute("data-suspend-calendar-hotkeys", "true");
    const input = document.createElement("input");
    rail.appendChild(input);
    document.body.appendChild(rail);

    fireEvent.keyDown(input, { key: "3", bubbles: true });

    expect(onViewChange).not.toHaveBeenCalled();

    rail.remove();
  });
});
