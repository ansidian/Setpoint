import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useCalendarModalViewModel from "./useCalendarModalViewModel";

// Regression for fe-calendar::compute-rebuilds-on-planning-status-churn:
// the events view's compute reads only data.events and data.deadlineOverlay,
// so a viewData identity bump driven purely by planning-status fields must NOT
// re-run compute, while a real change to events/deadlineOverlay must.

function makeEventsView() {
  return {
    compute: vi.fn(({ data }) => ({
      itemsByDay: {},
      itemsByDate: {},
      totalEvents: (data?.events || []).length,
    })),
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

    const { rerender } = renderHook((p) => useCalendarModalViewModel(p), { initialProps: props });
    expect(activeView.compute).toHaveBeenCalledTimes(1);

    // Planning-status transition: fresh viewData identity (new planningReadiness,
    // isLoading flip) but the narrow compute inputs are referentially stable.
    props = baseProps({
      activeView,
      visibleCalendarEvents: events,
      deadlineOverlay,
      viewData: { events, deadlineOverlay, planningReadiness: { state: "ready" }, isLoading: false },
    });
    rerender(props);
    expect(activeView.compute).toHaveBeenCalledTimes(1);
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

    const { rerender } = renderHook((p) => useCalendarModalViewModel(p), { initialProps: props });
    expect(activeView.compute).toHaveBeenCalledTimes(1);

    const eventsB = [{ id: "e1", startMs: 1 }, { id: "e2", startMs: 2 }];
    props = baseProps({
      activeView,
      visibleCalendarEvents: eventsB,
      deadlineOverlay,
      viewData: { events: eventsB, deadlineOverlay },
    });
    rerender(props);
    expect(activeView.compute).toHaveBeenCalledTimes(2);
    expect(activeView.compute.mock.results[1]!.value.totalEvents).toBe(2);
  });

  it("keeps bills compute keyed on the full viewData object", () => {
    const billsView = {
      compute: vi.fn(({ data }) => ({
        itemsByDay: {},
        itemsByDate: {},
        scheduleCount: (data?.schedules || []).length,
      })),
      label: "Bills",
    };
    const schedules = [{ next_date: "2026-06-10", amount: 5 }];
    let props = baseProps({
      view: "bills",
      activeView: billsView,
      visibleCalendarEvents: [],
      deadlineOverlay: null,
      viewData: { schedules, payeeMap: {}, isLoading: false },
    });

    const { rerender } = renderHook((p) => useCalendarModalViewModel(p), { initialProps: props });
    expect(billsView.compute).toHaveBeenCalledTimes(1);
    expect(billsView.compute.mock.results[0]!.value.scheduleCount).toBe(1);

    // New viewData identity (the bills view has no isolated narrow inputs) must
    // re-run compute to stay behavior-preserving for the bills shape.
    props = baseProps({
      view: "bills",
      activeView: billsView,
      visibleCalendarEvents: [],
      deadlineOverlay: null,
      viewData: { schedules, payeeMap: {}, isLoading: true },
    });
    rerender(props);
    expect(billsView.compute).toHaveBeenCalledTimes(2);
  });
});
