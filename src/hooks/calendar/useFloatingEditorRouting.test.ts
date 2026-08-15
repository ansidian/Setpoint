import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useFloatingEditorRouting, { type FloatingEditorItem, type FloatingEditorRoutingOptions } from "./useFloatingEditorRouting";
import type { CalendarEventCreateRequest } from "./calendarEventCreateBridge";

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
  it("starts with no deadline editor for an ordinary open", () => {
    const { result } = renderHook(() => useFloatingEditorRouting(routingProps()));
    expect(result.current.deadlineEditor).toBeNull();
    expect(result.current.deadlineDraftPreview).toBeNull();
  });

  it("seeds a deadline create editor from a 'new' focus request", () => {
    const { result } = renderHook(() => useFloatingEditorRouting(routingProps({
      focusItemId: "new",
      forceDeadlineOverlay: true,
      todayDateKey: "2026-04-20",
    })));
    expect(result.current.deadlineEditor).toEqual({ mode: "create", seedDate: "2026-04-20" });
  });

  it("exposes setters that drive the owned editor state", () => {
    const { result } = renderHook(() => useFloatingEditorRouting(routingProps()));

    act(() => result.current.setDeadlineEditor({ mode: "edit", taskId: "t9" }));
    expect(result.current.deadlineEditor).toEqual({ mode: "edit", taskId: "t9" });

    act(() => result.current.setDeadlineDraftPreview({ title: "draft" }));
    expect(result.current.deadlineDraftPreview).toEqual({ title: "draft" });
  });

  it("opens a deadline create editor seeded to the requested date", () => {
    const { result } = renderHook(() => useFloatingEditorRouting(routingProps()));
    act(() => result.current.openFloatingDeadlineCreate("2026-05-01"));
    expect(result.current.deadlineEditor).toEqual({ mode: "create", seedDate: "2026-05-01" });
    expect(result.current.deadlineDraftPreview).toBeNull();
  });

  it("closes an open event editor when switching to deadline create, so no event ghost lingers", () => {
    const eventEditorRef = {
      current: {
        closed: false,
        closeEditor() { this.closed = true; },
      },
    };
    const { result } = renderHook(() => useFloatingEditorRouting(routingProps({ eventEditorRef })));

    act(() => result.current.openFloatingDeadlineCreate("2026-05-01"));
    expect(eventEditorRef.current.closed).toBe(true);
  });

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

  it("anchors a seeded floating create workspace to its rendered event ghost", async () => {
    const dayCell = document.createElement("div");
    const ghostChip = document.createElement("div");
    ghostChip.dataset.testid = "calendar-ghost-chip";
    ghostChip.dataset.ghostKind = "event";
    ghostChip.dataset.ghostStart = "2026-05-01";
    document.body.appendChild(dayCell);
    const openFloatingDetail = vi.fn();
    const request: CalendarEventCreateRequest = {
      seed: { title: "Test Event", allDay: false, startDate: "2026-05-01", startTime: "15:00" },
      origin: { kind: "alfred-proposal", referenceId: "proposal-1" },
    };
    const { result } = renderHook(() => useFloatingEditorRouting(routingProps({
      eventEditorRef: { current: { openCreate: vi.fn().mockImplementation(async () => {
        let framesRemaining = 12;
        const mountGhostAfterColdRender = () => {
          if (framesRemaining === 0) {
            dayCell.appendChild(ghostChip);
            return;
          }
          framesRemaining -= 1;
          window.requestAnimationFrame(mountGhostAfterColdRender);
        };
        mountGhostAfterColdRender();
        return { accepted: true };
      }) } },
      findDateCell: () => dayCell,
      openFloatingDetail,
    })));

    await act(async () => {
      await result.current.openFloatingEventCreate("2026-05-01", request);
    });

    // test-architecture: allow-boundary-interaction -- The routed detail anchor is the stable boundary proving the seeded editor attaches to its ghost chip.
    expect(openFloatingDetail).toHaveBeenCalledWith(expect.objectContaining({
      anchorElement: ghostChip,
      sourceCellElement: dayCell,
      anchorKind: "chip",
    }));
    dayCell.remove();
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
