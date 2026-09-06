import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useFloatingEditorRouting, { type FloatingEditorItem, type FloatingEditorRoutingOptions } from "./useFloatingEditorRouting";

function routingProps(overrides: Partial<FloatingEditorRoutingOptions> = {}): FloatingEditorRoutingOptions {
  return {
    activeSelectedDateKey: "2026-04-20",
    activeView: { getItemId: (item: FloatingEditorItem) => item?.id },
    eventEditorRef: { current: {} },
    findDateCell: () => null,
    floatingDetailRef: { current: null },
    focusDate: null,
    focusItemId: null,
    forceDeadlineOverlay: false,
    open: true,
    openFloatingDetail: vi.fn(),
    selectedDay: 20,
    selectedItemId: null,
    setFloatingDetail: vi.fn(),
    setSelectedDateKey: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedItemId: vi.fn(),
    suppressAgendaPassiveSync: vi.fn(),
    todayDateKey: "2026-04-20",
    view: "events",
    viewMonth: 3,
    viewYear: 2026,
    ...overrides,
  };
}

describe("useFloatingEditorRouting deadline editor state ownership", () => {

  it("clears leftover deadline editor state when switching to event create", () => {
    const { result } = renderHook(() => useFloatingEditorRouting(routingProps()));

    act(() => {
      result.current.setDeadlineEditor({ mode: "create", seedDate: "2026-05-01" });
      result.current.setDeadlineDraftPreview({ title: "draft" });
    });
    act(() => { void result.current.openFloatingEventCreate("2026-05-01"); });

    expect(result.current.deadlineEditor).toBeNull();
    expect(result.current.deadlineDraftPreview).toBeNull();
  });

  it("clears the deadline editor after a successful save→detail transition", () => {
    const floatingDetailRef = {
      current: { open: true, detailKind: "deadline", mode: "edit", itemId: "t1", dateKey: "2026-04-20", day: 20 },
    };
    const { result } = renderHook(() => useFloatingEditorRouting(routingProps({ floatingDetailRef })));

    act(() => result.current.setDeadlineEditor({ mode: "edit", taskId: "t1" }));
    expect(result.current.deadlineEditor).not.toBeNull();

    act(() => result.current.handleFloatingDeadlineSaved({ id: "t1", due_date: "2026-04-20" }));
    expect(result.current.deadlineEditor).toBeNull();
    expect(result.current.deadlineDraftPreview).toBeNull();
  });
});
