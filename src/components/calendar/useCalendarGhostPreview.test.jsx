import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useCalendarGhostPreview from "./useCalendarGhostPreview.js";

function buildProps(overrides = {}) {
  return {
    open: true,
    view: "deadlines",
    viewData: {},
    computed: { itemsByDate: {} },
    eventEditor: { isEditorOpen: false },
    deadlineEditor: { mode: "create" },
    deadlineDraftPreview: {
      kind: "deadline",
      title: "Plan sprint",
      dueDate: "2026-05-02",
      dueTime: "9:00 AM",
      placementChanged: true,
    },
    viewYear: 2026,
    viewMonth: 3,
    setMonthMotionDirection: vi.fn(),
    setViewDate: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedDateKey: vi.fn(),
    setSelectedItemId: vi.fn(),
    manualMonthBrowseKey: 0,
    ...overrides,
  };
}

describe("useCalendarGhostPreview manual month browse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("suppresses ghost snapback after manual month-grid browsing until placement changes", () => {
    const setViewDate = vi.fn();
    const initialProps = buildProps({ setViewDate });
    const { rerender } = renderHook((props) => useCalendarGhostPreview(props), {
      initialProps,
    });

    rerender(buildProps({
      setViewDate,
      viewYear: 2026,
      viewMonth: 5,
      manualMonthBrowseKey: 1,
    }));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setViewDate).not.toHaveBeenCalled();

    rerender(buildProps({
      setViewDate,
      viewYear: 2026,
      viewMonth: 5,
      manualMonthBrowseKey: 1,
      deadlineDraftPreview: {
        kind: "deadline",
        title: "Plan sprint",
        dueDate: "2026-05-03",
        dueTime: "9:00 AM",
        placementChanged: true,
      },
    }));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setViewDate).toHaveBeenCalledWith({ year: 2026, month: 4 });
  });

  it("does not auto-navigate when a ghost target is already visible in the current grid", () => {
    const setViewDate = vi.fn();
    renderHook((props) => useCalendarGhostPreview(props), {
      initialProps: buildProps({
        setViewDate,
        viewYear: 2026,
        viewMonth: 4,
        deadlineDraftPreview: {
          kind: "deadline",
          title: "Plan sprint",
          dueDate: "2026-04-27",
          dueTime: "9:00 AM",
          placementChanged: true,
        },
      }),
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setViewDate).not.toHaveBeenCalled();
  });

  it("auto-navigates when a ghost target is outside the visible grid", () => {
    const setViewDate = vi.fn();
    renderHook((props) => useCalendarGhostPreview(props), {
      initialProps: buildProps({
        setViewDate,
        viewYear: 2026,
        viewMonth: 4,
        deadlineDraftPreview: {
          kind: "deadline",
          title: "Plan sprint",
          dueDate: "2026-04-25",
          dueTime: "9:00 AM",
          placementChanged: true,
        },
      }),
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setViewDate).toHaveBeenCalledWith({ year: 2026, month: 3 });
  });
});
