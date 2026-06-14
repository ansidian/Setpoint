import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api", () => ({
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

const { createCalendarEvent, createCalendarEventsBatch, deleteCalendarEvent, updateCalendarEvent } = await import("@/api");
const {
  default: useCalendarQuickActions,
  buildCloneEventPayload,
  buildColorUpdatePayload,
  buildOptimisticCloneEvent,
  buildOptimisticClipboardPasteEvent,
  buildReschedulePayload,
} = await import("./useCalendarQuickActions");
const {
  createCalendarEventClipboard,
  createCalendarEventSelectionSet,
} = await import("./calendarEventSelectionModel.js");
const { epochFromLa } = await import("../../inbox/helpers.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCalendarQuickActions helpers", () => {
  it("builds drag-drop reschedule payloads from the source date plus deltaDays and original time", () => {
    const event = {
      id: "event-drag-1",
      etag: '"etag-drag-1"',
      title: "Move me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
      location: "Office",
      description: "Notes",
    };

    expect(buildReschedulePayload(event, 1)).toEqual({
      accountId: "gmail-main",
      calendarId: "primary",
      title: "Move me",
      allDay: false,
      startDate: "2026-04-21",
      endDate: "2026-04-21",
      startTime: "09:00",
      endTime: "10:30",
      location: "Office",
      description: "Notes",
      etag: '"etag-drag-1"',
      scope: undefined,
      recurringEventId: undefined,
      originalStartTime: undefined,
    });
  });

  it("lands a late-evening drag on the correct calendar day across spring-forward DST", () => {
    // Sat Mar 7 2026 23:00 PT (PST, UTC-8) → drag one day to Sun Mar 8.
    // Spring-forward is 02:00 Mar 8; a fixed 86_400_000ms shift would push the
    // 23:00 instant to 00:00 Mon Mar 9 in Pacific wall-clock, landing the
    // payload on the wrong day. deltaDays arithmetic keeps it on Mar 8.
    const event = {
      id: "event-dst-drag",
      etag: '"etag-dst"',
      title: "Late night",
      accountId: "gmail-main",
      calendarId: "primary",
      // 2026-03-07 23:00 PST == 2026-03-08T07:00Z
      startMs: new Date("2026-03-08T07:00:00.000Z").getTime(),
      endMs: new Date("2026-03-08T07:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: false,
    };

    expect(buildReschedulePayload(event, 1)).toMatchObject({
      startDate: "2026-03-08",
      endDate: "2026-03-08",
      startTime: "23:00",
      endTime: "23:30",
    });
  });

  it("shifts a multi-day all-day reschedule by deltaDays preserving its span", () => {
    const event = {
      id: "event-allday-drag",
      title: "Conference",
      accountId: "gmail-main",
      calendarId: "primary",
      // all-day end is exclusive; 04-20 → 04-23 exclusive == 04-22 inclusive
      startMs: new Date("2026-04-20T07:00:00.000Z").getTime(),
      endMs: new Date("2026-04-23T07:00:00.000Z").getTime(),
      allDay: true,
    };

    expect(buildReschedulePayload(event, 5)).toMatchObject({
      startDate: "2026-04-25",
      endDate: "2026-04-27",
      startTime: null,
      endTime: null,
    });
  });

  it("builds standalone clone payloads on the target date without recurrence metadata", () => {
    const event = {
      id: "event-copy-1",
      etag: '"etag-copy-1"',
      title: "Copy me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      location: "Office",
      description: "Notes",
      colorId: "7",
    };

    expect(buildCloneEventPayload(event, "2026-04-22")).toEqual({
      accountId: "gmail-main",
      calendarId: "primary",
      title: "Copy me",
      allDay: false,
      startDate: "2026-04-22",
      endDate: "2026-04-22",
      startTime: "09:00",
      endTime: "10:30",
      location: "Office",
      description: "Notes",
      colorId: "7",
    });
  });

  it("uses mapped source color ids when cloning events without explicit overrides", () => {
    const event = {
      id: "event-copy-source-color",
      title: "Copy source color",
      accountId: "gmail-main",
      calendarId: "work",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      allDay: false,
      colorId: null,
      sourceColorId: "3",
    };

    expect(buildCloneEventPayload(event, "2026-04-22")).toMatchObject({
      colorId: "3",
    });
  });

  it("preserves all-day spans when cloning onto a target date", () => {
    const event = {
      id: "event-copy-all-day",
      title: "Trip",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T19:00:00.000Z").getTime(),
      endMs: new Date("2026-04-23T19:00:00.000Z").getTime(),
      allDay: true,
    };

    expect(buildCloneEventPayload(event, "2026-05-01")).toMatchObject({
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      startTime: null,
      endTime: null,
    });
  });

  it("builds optimistic standalone clone events on the target date", () => {
    const event = {
      id: "event-copy-optimistic",
      title: "Copy optimistic",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      colorId: "7",
    };

    expect(buildOptimisticCloneEvent(event, "2026-04-22")).toMatchObject({
      id: expect.stringMatching(/^optimistic-calendar-copy-event-copy-optimistic-/),
      title: "Copy optimistic",
      startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-22T17:30:00.000Z").getTime(),
      colorId: "7",
      color: "#46d6db",
      isRecurring: false,
      recurringEventId: null,
      originalStartTime: null,
      passed: false,
    });
  });

  it("computes optimistic clipboard-paste ms from Pacific wall-clock, not the host zone", () => {
    // The paste plan carries Pacific date/time strings; the server interprets
    // them in Pacific. The optimistic event must match. epochFromLa is always
    // anchored to America/Los_Angeles, so this equality holds regardless of the
    // host TZ — and the prior offsetless `new Date(date+"T"+time)` (host-local)
    // would only match it on a Pacific host.
    const item = {
      title: "Pasted lunch",
      accountId: "gmail-main",
      calendarId: "primary",
      allDay: false,
      startDate: "2026-06-15",
      startTime: "12:30",
      endDate: "2026-06-15",
      endTime: "13:30",
    };

    const optimistic = buildOptimisticClipboardPasteEvent(item, 0);
    expect(optimistic.startMs).toBe(epochFromLa(2026, 5, 15, 12, 30));
    expect(optimistic.endMs).toBe(epochFromLa(2026, 5, 15, 13, 30));
  });

  it("anchors optimistic all-day paste bounds to Pacific midnight with an exclusive end", () => {
    const item = {
      title: "Pasted holiday",
      accountId: "gmail-main",
      calendarId: "primary",
      allDay: true,
      startDate: "2026-06-15",
      startTime: null,
      endDate: "2026-06-15",
      endTime: null,
    };

    const optimistic = buildOptimisticClipboardPasteEvent(item, 0);
    expect(optimistic.startMs).toBe(epochFromLa(2026, 5, 15, 0, 0));
    // all-day end is exclusive — next Pacific midnight.
    expect(optimistic.endMs).toBe(epochFromLa(2026, 5, 16, 0, 0));
  });

  it("builds scoped color payloads for recurring events", () => {
    const event = {
      id: "event-color-1",
      etag: '"etag-color-1"',
      title: "Color me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    };

    expect(buildColorUpdatePayload(event, "11", "following")).toMatchObject({
      accountId: "gmail-main",
      calendarId: "primary",
      colorId: "11",
      scope: "following",
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    });
  });
});

describe("useCalendarQuickActions batch delete partial failure", () => {
  function makeEvent(overrides) {
    return {
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      allDay: false,
      isRecurring: false,
      writable: true,
      ...overrides,
    };
  }

  it("prunes only the deleted events and surfaces a partial-failure error for the rest", async () => {
    const keep = makeEvent({ id: "event-keep", etag: '"etag-keep"' });
    const drop = makeEvent({ id: "event-drop", etag: '"etag-drop"' });
    deleteCalendarEvent.mockImplementation((id) => (
      id === "event-drop"
        ? Promise.resolve({})
        : Promise.reject(new Error("Provider rejected delete."))
    ));
    const onBatchDeleted = vi.fn();
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onBatchDeleted,
    }));

    act(() => {
      result.current.requestBatchDelete({ events: [keep, drop], x: 80, y: 80 });
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // Both deletes were attempted — the loop did not abort after "event-keep" failed.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("event-keep", expect.anything());
    expect(deleteCalendarEvent).toHaveBeenCalledWith("event-drop", expect.anything());
    // Selection is pruned for the succeeded event only, never the failed one.
    expect(onBatchDeleted).toHaveBeenCalledTimes(1);
    const prunedIds = onBatchDeleted.mock.calls[0][0].map((event) => event.id);
    expect(prunedIds).toEqual(["event-drop"]);
    // Failed event was rolled back into the grid and the menu stays open with an error.
    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({ id: "event-keep" }));
    expect(result.current.contextMenu).toMatchObject({
      busy: false,
      error: "Deleted 1, failed 1.",
    });
  });

  it("does not prune selection when every batch delete fails", async () => {
    const a = makeEvent({ id: "event-a", etag: '"etag-a"' });
    const b = makeEvent({ id: "event-b", etag: '"etag-b"' });
    deleteCalendarEvent.mockRejectedValue(new Error("All deletes failed."));
    const onBatchDeleted = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents: vi.fn(),
      removeEvent: vi.fn(),
      onBatchDeleted,
    }));

    act(() => {
      result.current.requestBatchDelete({ events: [a, b], x: 80, y: 80 });
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    expect(deleteCalendarEvent).toHaveBeenCalledTimes(2);
    expect(onBatchDeleted).not.toHaveBeenCalled();
    expect(result.current.contextMenu).toMatchObject({
      busy: false,
      error: "All deletes failed.",
    });
  });
});

describe("useCalendarQuickActions clipboard paste failure", () => {
  it("surfaces an error status when a single-item paste create rejects", async () => {
    createCalendarEvent.mockRejectedValue(new Error("Provider down."));
    const source = {
      id: "event-paste-fail",
      title: "Paste me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      allDay: false,
      writable: true,
    };
    const clipboard = createCalendarEventClipboard(createCalendarEventSelectionSet([source]));
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onSelectEvent: vi.fn(),
    }));

    await act(async () => {
      await result.current.pasteEvent(clipboard, "2026-04-22");
    });

    const optimisticEvent = upsertEvents.mock.calls[0][0];
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvent.id);
    expect(result.current.status).toEqual({ tone: "error", message: "Failed to paste event." });
  });
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
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onSelectEvent,
    }));

    await act(async () => {
      await result.current.pasteEvent(clipboard, "2026-06-01");
    });

    expect(createCalendarEventsBatch).toHaveBeenCalledTimes(1);
    expect(createCalendarEventsBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        title: "First copied event",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        startTime: "09:00",
        endTime: "09:30",
      }),
      expect.objectContaining({
        title: "Second copied event",
        startDate: "2026-06-03",
        endDate: "2026-06-03",
        startTime: "10:00",
        endTime: "11:00",
        colorId: "7",
      }),
    ]);
    expect(createCalendarEvent).not.toHaveBeenCalled();
    const optimisticEvents = upsertEvents.mock.calls
      .map(([event]) => event)
      .filter((event) => String(event.id).startsWith("optimistic-calendar-copy-"));
    expect(optimisticEvents).toHaveLength(2);
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvents[0].id);
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvents[1].id);
    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({ id: "google-created-first" }));
    expect(onSelectEvent).toHaveBeenCalledWith("google-created-first", "2026-06-01");
  });

  it("treats deleting a pending optimistic clone as cancellation until the provider create reconciles", async () => {
    let resolveCreate;
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

    const optimisticEvent = upsertEvents.mock.calls[0][0];
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

    const optimisticEvent = upsertEvents.mock.calls[0][0];
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
