import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useCalendarMonthNavigation from "./useCalendarMonthNavigation";

function setup(overrides = {}) {
  const setters = {
    setViewDate: vi.fn(),
    setFetchAnchor: vi.fn(),
    setLabelMonth: vi.fn(),
    setManualMonthBrowseKey: vi.fn(),
    setSelectedDay: vi.fn(),
    setSelectedDateKey: vi.fn(),
    setSelectedItemId: vi.fn(),
    setDeadlineEditor: vi.fn(),
    setDeadlineDraftPreview: vi.fn(),
  };
  const sync = {
    syncAgendaToMonth: vi.fn(),
    onGridScrollCrossing: vi.fn(),
    onGridScrollSettle: vi.fn(),
    isAgendaDriven: vi.fn(() => false),
  };
  const props = {
    currentYear: 2026,
    currentMonth: 5,
    viewYear: 2026,
    viewMonth: 11,
    fetchAnchor: { year: 2026, month: 11 },
    floatingDetailRef: { current: null },
    eventEditorRef: { current: null },
    deadlineEditor: null,
    closeEventEditor: vi.fn(),
    sync,
    ...setters,
    ...overrides,
  };
  const hook = renderHook((currentProps) => useCalendarMonthNavigation(currentProps), {
    initialProps: props,
  });
  return { ...hook, props, setters, sync };
}

describe("useCalendarMonthNavigation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coordinates month navigation, idle selection cleanup, and agenda targeting", () => {
    const { result, props, setters, sync } = setup();

    act(() => result.current.navigateMonth(1));

    const target = { year: 2027, month: 0 };
    expect(setters.setDeadlineDraftPreview).toHaveBeenCalledWith(null);
    expect(props.closeEventEditor).toHaveBeenCalledOnce();
    expect(setters.setSelectedDay).toHaveBeenCalledWith(null);
    expect(setters.setSelectedDateKey).toHaveBeenCalledWith(null);
    expect(setters.setSelectedItemId).toHaveBeenCalledWith(null);
    expect(setters.setDeadlineEditor).toHaveBeenCalledWith(null);
    expect(setters.setManualMonthBrowseKey).toHaveBeenCalledWith(expect.any(Function));
    expect(setters.setViewDate).toHaveBeenCalledWith(target);
    expect(setters.setFetchAnchor).toHaveBeenCalledWith(target);
    expect(setters.setLabelMonth).toHaveBeenCalledWith(target);
    expect(sync.syncAgendaToMonth).toHaveBeenCalledWith(2027, 0);
    expect(result.current.navigateMonthRef.current).toBe(result.current.navigateMonth);
  });

  it.each([
    ["floating create", { floatingDetailRef: { current: { open: true, mode: "create" } } }],
    ["floating edit", { floatingDetailRef: { current: { open: true, mode: "edit" } } }],
    ["inline event edit", { eventEditorRef: { current: { isEditorOpen: true } } }],
    ["deadline create", { deadlineEditor: { mode: "create" } }],
    ["deadline edit", { deadlineEditor: { mode: "edit" } }],
  ])("preserves selection and editor state across month navigation for %s", (_label, editorOverrides) => {
    const { result, props, setters, sync } = setup(editorOverrides);

    act(() => result.current.navigateMonth(1));

    expect(props.closeEventEditor).not.toHaveBeenCalled();
    expect(setters.setSelectedDay).not.toHaveBeenCalled();
    expect(setters.setSelectedDateKey).not.toHaveBeenCalled();
    expect(setters.setSelectedItemId).not.toHaveBeenCalled();
    expect(setters.setDeadlineEditor).not.toHaveBeenCalled();
    expect(setters.setDeadlineDraftPreview).not.toHaveBeenCalled();
    expect(setters.setViewDate).toHaveBeenCalledWith({ year: 2027, month: 0 });
    expect(sync.syncAgendaToMonth).toHaveBeenCalledWith(2027, 0);
  });

  it("keeps floating editors isolated from free-scroll month crossings and settles", () => {
    const floatingDetailRef = { current: { open: true, mode: "edit" } };
    const { result, setters, sync } = setup({ floatingDetailRef });

    act(() => result.current.onDisplayMonthChange({ year: 2027, month: 0 }));
    act(() => result.current.onFetchSettle({ year: 2027, month: 0, scrollDriven: true }));

    expect(setters.setViewDate).not.toHaveBeenCalled();
    expect(setters.setFetchAnchor).toHaveBeenCalledWith({ year: 2027, month: 0 });
    expect(sync.onGridScrollCrossing).not.toHaveBeenCalled();
    expect(sync.onGridScrollSettle).not.toHaveBeenCalled();
  });

  it("tracks scroll direction and preserves the settle's scroll-driven verdict only for anchor moves", () => {
    vi.useFakeTimers();
    const { result, props, setters, sync, rerender } = setup();

    act(() => result.current.onDisplayMonthChange({ year: 2026, month: 11 }));
    expect(result.current.scrollDirectionRef.current).toBe("idle");
    act(() => result.current.onDisplayMonthChange({ year: 2027, month: 0 }));
    expect(result.current.scrollDirectionRef.current).toBe("forward");
    expect(setters.setViewDate).toHaveBeenLastCalledWith({ year: 2027, month: 0 });
    expect(sync.onGridScrollCrossing).toHaveBeenLastCalledWith({ year: 2027, month: 0 });

    act(() => vi.runAllTimers());
    expect(result.current.scrollDirectionRef.current).toBe("idle");

    act(() => result.current.onFetchSettle({
      year: 2027,
      month: 1,
      scrollDriven: false,
    }));
    expect(setters.setFetchAnchor).toHaveBeenLastCalledWith({ year: 2027, month: 1 });
    expect(sync.onGridScrollSettle).not.toHaveBeenCalled();
    expect(result.current.scrollDrivenRef.current).toBe(false);

    rerender({ ...props, fetchAnchor: { year: 2027, month: 1 } });
    result.current.scrollDrivenRef.current = false;
    act(() => result.current.onFetchSettle({
      year: 2027,
      month: 1,
      scrollDriven: true,
    }));
    expect(result.current.scrollDrivenRef.current).toBe(false);
    expect(sync.onGridScrollSettle).toHaveBeenCalledWith({ year: 2027, month: 1 });
  });
});
