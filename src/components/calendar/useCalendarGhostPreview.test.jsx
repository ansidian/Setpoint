import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useCalendarGhostPreview from "./useCalendarGhostPreview.js";

function buildProps(overrides = {}) {
  return {
    open: true,
    view: "events",
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
    setFetchAnchor: vi.fn(),
    setLabelMonth: vi.fn(),
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

  it("produces deadline ghosts while composing Todoist items in Events view", () => {
    const { result } = renderHook((props) => useCalendarGhostPreview(props), {
      initialProps: buildProps({
        view: "events",
        computed: {
          itemsByDate: {
            "2026-05-02": [{ id: "existing", due_time: "10:00 AM", source: "todoist" }],
          },
        },
      }),
    });

    expect(result.current?.ghosts).toEqual([
      expect.objectContaining({
        kind: "deadline",
        title: "Plan sprint",
        startDate: "2026-05-02",
        endDate: "2026-05-02",
        dueTime: "9:00 AM",
      }),
    ]);
  });

  it("keeps event ghost conflict metadata stable when only editor text changes", () => {
    const events = [{
      id: "meeting",
      title: "Existing meeting",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-02T16:05:00.000Z").getTime(),
      endMs: new Date("2026-05-02T16:20:00.000Z").getTime(),
    }];
    const eventEditor = {
      isEditorOpen: true,
      draft: {
        accountId: "gmail-main",
        calendarId: "primary",
        allDay: false,
        title: "Draft title",
        startDate: "2026-05-02",
        endDate: "2026-05-02",
        startTime: "09:00",
        endTime: "09:30",
      },
      effectiveTitle: "Draft title",
      intentState: { mode: "single" },
      writableCalendars: [{ value: "gmail-main::primary", color: "#4285f4" }],
    };
    const { result, rerender } = renderHook((props) => useCalendarGhostPreview(props), {
      initialProps: buildProps({
        eventEditor,
        deadlineEditor: null,
        deadlineDraftPreview: null,
        viewData: { events },
      }),
    });
    const initialConflictTitles = result.current?.ghosts?.[0]?.conflictTitles;
    expect(result.current?.ghosts?.[0]).toMatchObject({
      title: "Draft title",
      conflictCount: 1,
      conflictTitles: ["Existing meeting"],
    });

    rerender(buildProps({
      eventEditor: {
        ...eventEditor,
        draft: {
          ...eventEditor.draft,
          title: "Draft title, still typing",
        },
        effectiveTitle: "Draft title, still typing",
      },
      deadlineEditor: null,
      deadlineDraftPreview: null,
      viewData: { events },
    }));

    expect(result.current?.ghosts?.[0]).toMatchObject({
      title: "Draft title, still typing",
      conflictCount: 1,
      conflictTitles: ["Existing meeting"],
    });
    expect(result.current?.ghosts?.[0]?.conflictTitles).toBe(initialConflictTitles);
  });

  it("keeps deadline ghost crowding metadata stable when only draft title changes", () => {
    const dateItems = { activeCount: 3 };
    const computed = {
      itemsByDate: {
        "2026-05-02": dateItems,
      },
    };
    const { result, rerender } = renderHook((props) => useCalendarGhostPreview(props), {
      initialProps: buildProps({
        computed,
        deadlineDraftPreview: {
          kind: "deadline",
          title: "Draft task",
          dueDate: "2026-05-02",
          dueTime: "9:00 AM",
          placementChanged: true,
        },
      }),
    });
    const initialGhost = result.current?.ghosts?.[0];
    expect(initialGhost).toMatchObject({
      title: "Draft task",
      crowdedCount: 3,
    });

    rerender(buildProps({
      computed,
      deadlineDraftPreview: {
        kind: "deadline",
        title: "Draft task, still typing",
        dueDate: "2026-05-02",
        dueTime: "9:00 AM",
        placementChanged: true,
      },
    }));

    expect(result.current?.ghosts?.[0]).toMatchObject({
      title: "Draft task, still typing",
      crowdedCount: 3,
    });
    expect(result.current?.ghosts?.[0]).toEqual({
      ...initialGhost,
      title: "Draft task, still typing",
    });
  });
});
