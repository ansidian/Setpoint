import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../components/calendar/CalendarModal.test-setup.ts";
import CalendarModal from "../../components/calendar/CalendarModal.tsx";
import { wrapWithDashboard } from "../../components/calendar/CalendarModal.test-utils.tsx";

// Root-level integration guardrails for the controller-to-hotkey wiring. The
// hook's routing policy is covered directly in useCalendarModalHotkeys.suspend.

interface RenderModalOptions {
  view?: "events" | "bills";
  billsRangeData?: { ensureRange: ReturnType<typeof vi.fn> };
  onViewChange?: (view: string) => void;
}

function renderModal({ view = "events", billsRangeData, onViewChange }: RenderModalOptions = {}) {
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

afterEach(cleanup);

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
});
