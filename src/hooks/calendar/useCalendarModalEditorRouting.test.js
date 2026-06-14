import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useFloatingEditorRouting, {
  resolveFloatingDeadlineItemId,
  resolveFloatingEventItemId,
} from "./useCalendarModalEditorRouting.js";

// Build the full prop union for the routing hook. Includes both the legacy inputs
// (setDeadlineEditor / setDeadlineDraftPreview) and the post-extraction init inputs
// (open / view / focus* / todayDateKey), so the same harness drives the hook before
// and after deadline-editor state ownership moves into it (EAD-319).
function routingProps(overrides = {}) {
  return {
    activeSelectedDateKey: "2026-04-20",
    activeView: { getItemId: (item) => item?.id },
    eventEditorRef: { current: {} },
    findDateCell: () => null,
    floatingDetailRef: { current: null },
    openFloatingDetail: vi.fn(),
    selectedDay: 20,
    selectedItemId: null,
    setDeadlineDraftPreview: vi.fn(),
    setDeadlineEditor: vi.fn(),
    setFloatingDetail: vi.fn(),
    setSelectedDateKey: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedItemId: vi.fn(),
    suppressAgendaPassiveSync: vi.fn(),
    viewMonth: 3,
    viewYear: 2026,
    open: true,
    view: "events",
    focusItemId: null,
    focusDate: null,
    forceDeadlineOverlay: false,
    todayDateKey: "2026-04-20",
    ...overrides,
  };
}

describe("useFloatingEditorRouting save→detail (characterization)", () => {
  it("transitions a saved event editor to detail mode", () => {
    const setFloatingDetail = vi.fn();
    const floatingDetailRef = {
      current: { open: true, view: "events", mode: "edit", itemId: "e1", dateKey: "2026-04-20", day: 20 },
    };
    const { result } = renderHook(() => useFloatingEditorRouting(
      routingProps({ floatingDetailRef, setFloatingDetail }),
    ));

    act(() => result.current.handleEventEditorSaved({ id: "e1" }));

    expect(setFloatingDetail).toHaveBeenCalledTimes(1);
    expect(setFloatingDetail.mock.calls[0][0]).toMatchObject({
      mode: "detail",
      itemId: "e1",
      dateKey: "2026-04-20",
      dirty: false,
    });
  });

  it("transitions a saved deadline editor to detail mode through the same path", () => {
    const setFloatingDetail = vi.fn();
    const floatingDetailRef = {
      current: { open: true, detailKind: "deadline", mode: "edit", itemId: "t1", dateKey: "2026-04-20", day: 20 },
    };
    const { result } = renderHook(() => useFloatingEditorRouting(
      routingProps({ floatingDetailRef, setFloatingDetail }),
    ));

    act(() => result.current.handleFloatingDeadlineSaved({ id: "t1", due_date: "2026-04-20" }));

    expect(setFloatingDetail).toHaveBeenCalledTimes(1);
    expect(setFloatingDetail.mock.calls[0][0]).toMatchObject({
      mode: "detail",
      itemId: "t1",
      dateKey: "2026-04-20",
      dirty: false,
    });
  });
});

describe("useCalendarModalEditorRouting", () => {
  it("keeps floating deadline saves keyed to the agenda selection id", () => {
    const activeView = {
      getItemId: (task) => `todoist:${task.id}-${task.due_date}`,
    };

    expect(resolveFloatingDeadlineItemId(activeView, {
      id: "task-1",
      due_date: "2026-05-12",
    })).toBe("todoist:task-1-2026-05-12");
  });

  it("falls back to the current floating event id when a saved event has no resolved view id", () => {
    expect(resolveFloatingEventItemId({}, {}, { itemId: "agenda-event-id" }))
      .toBe("agenda-event-id");
  });
});
