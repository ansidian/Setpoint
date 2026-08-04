import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import useCalendarModalViewModel from "./useCalendarModalViewModel";

// Regression for fe-calendar::compute-rebuilds-on-planning-status-churn:
// the events view's compute reads only data.events and data.deadlineOverlay,
// so a viewData identity bump driven purely by planning-status fields must NOT
// re-run compute, while a real change to events/deadlineOverlay must.

function makeEventsView() {
  return {
    compute: ({ data }: { data: unknown }) => {
      const events = (data as { events?: unknown[] } | null)?.events ?? [];
      return {
        itemsByDay: {},
        itemsByDate: {},
        totalEvents: events.length,
      };
    },
    canNavigateBack: () => true,
    label: "Events",
  };
}

function baseProps(overrides = {}) {
  return {
    open: false,
    view: "events",
    activeView: makeEventsView(),
    activeLayout: { panelWidth: "100px", viewportMargin: 8, stacked: false },
    currentYear: 2026,
    currentMonth: 5,
    viewYear: 2026,
    viewMonth: 5,
    labelYear: 2026,
    labelMonthValue: 5,
    activeSelectedDay: null,
    activeSelectedDateKey: null,
    activeSelectedItemId: null,
    eventEditor: { isEditorOpen: false },
    deadlineEditor: null,
    deadlineDraftPreview: null,
    weatherData: null,
    floatingDetail: null,
    setViewDate: () => {},
    setFetchAnchor: () => {},
    setLabelMonth: () => {},
    setSelectedDay: () => {},
    setSelectedDateKey: () => {},
    setSelectedItemId: () => {},
    manualMonthBrowseKey: 0,
    visibleCalendarEvents: [],
    deadlineOverlay: null,
    ...overrides,
  };
}

describe("useCalendarModalViewModel compute keying", () => {
  it("does not re-run events compute when only viewData status identity churns", () => {
    const activeView = makeEventsView();
    const events = [{ id: "e1", startMs: 1 }];
    const deadlineOverlay = { enabled: false };
    let props = baseProps({
      activeView,
      visibleCalendarEvents: events,
      deadlineOverlay,
      viewData: { events, deadlineOverlay, planningReadiness: { state: "idle" }, isLoading: true },
    });

    const { result, rerender } = renderHook((p) => useCalendarModalViewModel(p), { initialProps: props });
    const computedBeforeStatusChange = result.current.computed;

    // Planning-status transition: fresh viewData identity (new planningReadiness,
    // isLoading flip) but the narrow compute inputs are referentially stable.
    props = baseProps({
      activeView,
      visibleCalendarEvents: events,
      deadlineOverlay,
      viewData: { events, deadlineOverlay, planningReadiness: { state: "ready" }, isLoading: false },
    });
    rerender(props);
    expect(result.current.computed).toBe(computedBeforeStatusChange);
  });

  it("re-runs events compute when visibleCalendarEvents identity changes", () => {
    const activeView = makeEventsView();
    const deadlineOverlay = { enabled: false };
    const eventsA = [{ id: "e1", startMs: 1 }];
    let props = baseProps({
      activeView,
      visibleCalendarEvents: eventsA,
      deadlineOverlay,
      viewData: { events: eventsA, deadlineOverlay },
    });

    const { result, rerender } = renderHook((p) => useCalendarModalViewModel(p), { initialProps: props });
    expect(result.current.computed.totalEvents).toBe(1);

    const eventsB = [{ id: "e1", startMs: 1 }, { id: "e2", startMs: 2 }];
    props = baseProps({
      activeView,
      visibleCalendarEvents: eventsB,
      deadlineOverlay,
      viewData: { events: eventsB, deadlineOverlay },
    });
    rerender(props);
    expect(result.current.computed.totalEvents).toBe(2);
  });

});
