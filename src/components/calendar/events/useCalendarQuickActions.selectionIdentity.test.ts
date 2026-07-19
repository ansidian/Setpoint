import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api", () => ({
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

const api = await import("@/api");
const createCalendarEvent = api.createCalendarEvent as ReturnType<typeof vi.fn>;
const updateCalendarEvent = api.updateCalendarEvent as ReturnType<typeof vi.fn>;
// Pure payload/date-math builders now live in calendarQuickActionModel and are
// covered by calendarQuickActionModel.test.js; this file tests the hook's
// optimistic-mutation / state behavior only.
const { default: useCalendarQuickActions } = await import("./useCalendarQuickActions");
const {
  createCalendarEventClipboard,
  createCalendarEventSelectionSet,
} = await import("./calendarEventSelectionModel");

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCalendarQuickActions reconcile selection", () => {
  it("swaps the selected id via onReconcileSelection on single paste without re-selecting the day", async () => {
    createCalendarEvent.mockResolvedValue({
      event: {
        id: "google-created-single",
        title: "Pasted",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
        allDay: false,
        writable: true,
      },
    });
    const source = {
      id: "event-paste-reconcile",
      title: "Pasted",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      allDay: false,
      writable: true,
    };
    const clipboard = createCalendarEventClipboard(createCalendarEventSelectionSet([source]));
    const onSelectEvent = vi.fn();
    const onReconcileSelection = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents: vi.fn(),
      removeEvent: vi.fn(),
      onSelectEvent,
      onReconcileSelection,
    }));

    await act(async () => {
      await result.current.pasteEvent(clipboard, "2026-04-22");
    });

    // The optimistic select fires once, synchronously with the paste, and is the
    // only call that moves the day cell. The reconcile must NOT re-assert the day
    // (a delayed day-move races against the user navigating to the next paste target).
    expect(onSelectEvent).toHaveBeenCalledTimes(1);
    const [optimisticId, optimisticDay] = onSelectEvent.mock.calls[0]!;
    expect(optimisticId).toMatch(/^optimistic-calendar-copy-/);
    expect(optimisticDay).toBe("2026-04-22");
    expect(onReconcileSelection).toHaveBeenCalledWith(optimisticId, "google-created-single");
  });

  it("swaps the selected id via onReconcileSelection on clone without re-selecting the day", async () => {
    createCalendarEvent.mockResolvedValue({
      event: {
        id: "google-created-clone",
        title: "Clone",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
        allDay: false,
        writable: true,
      },
    });
    const source = {
      id: "event-clone-reconcile",
      title: "Clone",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      allDay: false,
      writable: true,
    };
    const onSelectEvent = vi.fn();
    const onReconcileSelection = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents: vi.fn(),
      removeEvent: vi.fn(),
      onSelectEvent,
      onReconcileSelection,
    }));

    await act(async () => {
      // A bare event (not a clipboard) routes through the clone/duplicate path.
      await result.current.pasteEvent(source, "2026-04-22");
    });

    expect(onSelectEvent).toHaveBeenCalledTimes(1);
    const [optimisticId] = onSelectEvent.mock.calls[0]!;
    expect(optimisticId).toMatch(/^optimistic-calendar-copy-/);
    expect(onReconcileSelection).toHaveBeenCalledWith(optimisticId, "google-created-clone");
  });
});

describe("useCalendarQuickActions identity stability", () => {
  function makeProps() {
    return {
      editable: true,
      layout: { stacked: false },
      upsertEvents: vi.fn(),
      removeEvent: vi.fn(),
      refreshRange: vi.fn(),
      onSelectEvent: vi.fn(),
      onEventDeleted: vi.fn(),
      onBatchDeleted: vi.fn(),
      onCopyEvent: vi.fn(),
      resolveEventActionScope: vi.fn(),
    };
  }

  it("returns the same actions object when the parent re-renders with fresh callback props", () => {
    const { result, rerender } = renderHook((props) => useCalendarQuickActions(props), {
      initialProps: makeProps(),
    });
    const first = result.current;

    rerender(makeProps());

    expect(result.current).toBe(first);
  });

  it("invokes the latest onSelectEvent rather than the mount-time one", async () => {
    const mountProps = makeProps();
    const { result, rerender } = renderHook((props) => useCalendarQuickActions(props), {
      initialProps: mountProps,
    });
    const nextProps = makeProps();
    rerender(nextProps);

    updateCalendarEvent.mockResolvedValue({ event: null });
    await act(async () => {
      await result.current.dropEvent({
        event: {
          id: "event-latest-1",
          writable: true,
          isRecurring: false,
          allDay: false,
          startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
          endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
        },
        targetDate: "2026-04-21",
      });
    });

    expect(nextProps.onSelectEvent).toHaveBeenCalledWith("event-latest-1", "2026-04-21");
    expect(mountProps.onSelectEvent).not.toHaveBeenCalled();
  });
});
