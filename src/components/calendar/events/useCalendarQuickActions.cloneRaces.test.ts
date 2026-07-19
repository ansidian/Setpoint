import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarQuickActionEvent } from "./calendarQuickActionModel";

vi.mock("@/api", () => ({
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

const api = await import("@/api");
const createCalendarEvent = api.createCalendarEvent as ReturnType<typeof vi.fn>;
const createCalendarEventsBatch = api.createCalendarEventsBatch as ReturnType<typeof vi.fn>;
const deleteCalendarEvent = api.deleteCalendarEvent as ReturnType<typeof vi.fn>;
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

describe("useCalendarQuickActions clone races", () => {
  it("pastes multi-event internal clipboards through batch create and removes failed optimistic rows without retry", async () => {
    createCalendarEventsBatch.mockResolvedValue({
      created: [
        {
          index: 0,
          event: {
            id: "google-created-first",
            title: "First copied event",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-06-01T16:00:00.000Z").getTime(),
            endMs: new Date("2026-06-01T16:30:00.000Z").getTime(),
            allDay: false,
            writable: true,
          },
        },
      ],
      failed: [
        {
          index: 1,
          message: "Provider rejected the second event.",
        },
      ],
    });
    const first = {
      id: "event-copy-first",
      title: "First copied event",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-18T16:00:00.000Z").getTime(),
      endMs: new Date("2026-05-18T16:30:00.000Z").getTime(),
      allDay: false,
      writable: true,
    };
    const second = {
      id: "event-copy-second",
      title: "Second copied event",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-05-20T17:00:00.000Z").getTime(),
      endMs: new Date("2026-05-20T18:00:00.000Z").getTime(),
      allDay: false,
      writable: true,
      colorId: "7",
    };
    const clipboard = createCalendarEventClipboard(createCalendarEventSelectionSet([second, first]));
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const onSelectEvent = vi.fn();
    const onReconcileSelection = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onSelectEvent,
      onReconcileSelection,
    }));

    await act(async () => {
      await result.current.pasteEvent(clipboard, "2026-06-01");
    });

    expect(createCalendarEventsBatch).toHaveBeenCalledTimes(1);
    expect(createCalendarEvent).not.toHaveBeenCalled();
    const optimisticEvents = upsertEvents.mock.calls
      .map(([event]) => event)
      .filter((event) => String(event.id).startsWith("optimistic-calendar-copy-"));
    expect(optimisticEvents).toHaveLength(2);
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvents[0].id);
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvents[1].id);
    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({ id: "google-created-first" }));
    // The optimistic select moved the day once; the reconcile only swaps the id of
    // the first optimistic row for its real server id, without re-asserting the day.
    expect(onSelectEvent).toHaveBeenCalledTimes(1);
    expect(onSelectEvent).toHaveBeenCalledWith(optimisticEvents[0].id, "2026-06-01");
    expect(onReconcileSelection).toHaveBeenCalledWith(optimisticEvents[0].id, "google-created-first");
  });

  it("treats deleting a pending optimistic clone as cancellation until the provider create reconciles", async () => {
    let resolveCreate!: (value: unknown) => void;
    createCalendarEvent.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    deleteCalendarEvent.mockResolvedValue({});
    const sourceEvent = {
      id: "event-copy-race",
      title: "Race copy",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      writable: true,
    };
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const onSelectEvent = vi.fn();
    const onEventDeleted = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onSelectEvent,
      onEventDeleted,
    }));

    act(() => {
      result.current.pasteEvent(sourceEvent, "2026-04-22");
    });

    const optimisticEvent = upsertEvents.mock.calls[0]![0];
    expect(optimisticEvent.id).toMatch(/^optimistic-calendar-copy-event-copy-race-/);

    await act(async () => {
      result.current.openContextMenu({ event: optimisticEvent, x: 80, y: 80 });
    });
    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    expect(deleteCalendarEvent).not.toHaveBeenCalledWith(optimisticEvent.id, expect.anything());
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvent.id);

    await act(async () => {
      resolveCreate({
        event: {
          ...optimisticEvent,
          id: "google-created-copy",
          etag: '"etag-created-copy"',
        },
      });
    });

    expect(upsertEvents).not.toHaveBeenCalledWith(expect.objectContaining({ id: "google-created-copy" }));
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-copy", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-created-copy"',
    }));
    expect(onEventDeleted).toHaveBeenCalledWith(optimisticEvent.id, optimisticEvent);
  });

  it("deletes the reconciled event when a temp clone menu confirms after create resolves", async () => {
    createCalendarEvent.mockResolvedValue({
      event: {
        id: "google-created-copy-late-delete",
        title: "Late delete copy",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-22T17:30:00.000Z").getTime(),
        allDay: false,
        writable: true,
        etag: '"etag-late-delete"',
      },
    });
    deleteCalendarEvent.mockResolvedValue({});
    const sourceEvent = {
      id: "event-copy-late-delete",
      title: "Late delete copy",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      writable: true,
    };
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const onEventDeleted = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onEventDeleted,
    }));

    act(() => {
      result.current.pasteEvent(sourceEvent, "2026-04-22");
    });

    const optimisticEvent = upsertEvents.mock.calls[0]![0];
    await act(async () => {
      result.current.openContextMenu({ event: optimisticEvent, x: 80, y: 80 });
    });
    await act(async () => {});

    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    expect(removeEvent).toHaveBeenCalledWith("google-created-copy-late-delete");
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-copy-late-delete", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-late-delete"',
    }));
    expect(onEventDeleted).toHaveBeenCalledWith("google-created-copy-late-delete", expect.objectContaining({
      id: "google-created-copy-late-delete",
    }));
  });
});
