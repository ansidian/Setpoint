import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api", () => ({
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

const { createCalendarEvent, createCalendarEventsBatch, deleteCalendarEvent, updateCalendarEvent } = await import("@/api");
// Pure payload/date-math builders now live in calendarQuickActionModel.js and are
// covered by calendarQuickActionModel.test.js; this file tests the hook's
// optimistic-mutation / state behavior only.
const { default: useCalendarQuickActions } = await import("./useCalendarQuickActions");
const {
  createCalendarEventClipboard,
  createCalendarEventSelectionSet,
} = await import("./calendarEventSelectionModel.js");

afterEach(() => {
  vi.clearAllMocks();
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

describe("useCalendarQuickActions delete timeout settles by reverting", () => {
  it("restores the event and surfaces an error status when a delete times out", async () => {
    const timeoutErr = Object.assign(
      new Error("Request timed out — check the calendar before retrying; the change may not have saved."),
      { code: "request_timeout" },
    );
    deleteCalendarEvent.mockRejectedValue(timeoutErr);
    const event = {
      id: "event-timeout",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      allDay: false,
      isRecurring: false,
      writable: true,
      etag: '"etag-timeout"',
    };
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onEventDeleted: vi.fn(),
    }));

    act(() => {
      result.current.openContextMenu({ event, x: 80, y: 80 });
    });
    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // The optimistic removal is reverted (event re-upserted) and the timeout is
    // surfaced — the mutation SETTLED rather than leaving the grid diverged.
    expect(removeEvent).toHaveBeenCalledWith("event-timeout");
    expect(upsertEvents).toHaveBeenCalledWith(event);
    expect(result.current.status).toMatchObject({ tone: "error" });
    expect(result.current.status.message).toContain("timed out");
  });
});

describe("useCalendarQuickActions marks months stale after failed mutations", () => {
  it("marks the event's months stale after a delete rejects and reverts", async () => {
    deleteCalendarEvent.mockRejectedValue(new Error("Provider down."));
    const event = {
      id: "event-stale",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      allDay: false,
      isRecurring: false,
      writable: true,
      etag: '"etag-stale"',
    };
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const markStale = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      markStale,
      onEventDeleted: vi.fn(),
    }));

    act(() => {
      result.current.openContextMenu({ event, x: 80, y: 80 });
    });
    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // The optimistic removal is reverted AND the touched months are marked stale
    // so the next range pass re-fetches truth from Google (self-heals a mutation
    // that may have applied server-side before the client gave up).
    expect(upsertEvents).toHaveBeenCalledWith(event);
    expect(markStale).toHaveBeenCalledWith("2026-04-20", "2026-04-20");
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
    // The optimistic select moved the day once; the reconcile only swaps the id of
    // the first optimistic row for its real server id, without re-asserting the day.
    expect(onSelectEvent).toHaveBeenCalledTimes(1);
    expect(onSelectEvent).toHaveBeenCalledWith(optimisticEvents[0].id, "2026-06-01");
    expect(onReconcileSelection).toHaveBeenCalledWith(optimisticEvents[0].id, "google-created-first");
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

describe("useCalendarQuickActions clipboard paste delete-during-create race", () => {
  function makeSource(overrides) {
    return {
      title: "Paste race",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      allDay: false,
      writable: true,
      ...overrides,
    };
  }

  it("deletes the created event when a single paste row is deleted before its create resolves", async () => {
    let resolveCreate;
    createCalendarEvent.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    deleteCalendarEvent.mockResolvedValue({});
    const clipboard = createCalendarEventClipboard(
      createCalendarEventSelectionSet([makeSource({ id: "event-paste-race" })]),
    );
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const onEventDeleted = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onSelectEvent: vi.fn(),
      onEventDeleted,
    }));

    act(() => {
      result.current.pasteEvent(clipboard, "2026-04-22");
    });
    const optimisticEvent = upsertEvents.mock.calls[0][0];
    expect(optimisticEvent.id).toMatch(/^optimistic-calendar-copy-/);

    // Delete the optimistic paste row while its create is still in flight.
    await act(async () => {
      result.current.openContextMenu({ event: optimisticEvent, x: 80, y: 80 });
    });
    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // No server delete of the optimistic id (nothing exists on Google yet), and
    // the optimistic row is pulled from the grid.
    expect(deleteCalendarEvent).not.toHaveBeenCalledWith(optimisticEvent.id, expect.anything());
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvent.id);

    // The create lands after the delete: the event must be deleted on Google,
    // NOT resurrected in the grid (the ghost-delete inverse).
    await act(async () => {
      resolveCreate({
        event: {
          ...optimisticEvent,
          id: "google-created-paste",
          etag: '"etag-paste"',
        },
      });
    });

    expect(upsertEvents).not.toHaveBeenCalledWith(expect.objectContaining({ id: "google-created-paste" }));
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-paste", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-paste"',
    }));
  });

  it("routes a normal server delete when a paste row is deleted after its create reconciles", async () => {
    createCalendarEvent.mockResolvedValue({
      event: {
        id: "google-created-paste-late",
        title: "Paste race",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
        allDay: false,
        isRecurring: false,
        writable: true,
        etag: '"etag-late"',
      },
    });
    deleteCalendarEvent.mockResolvedValue({});
    const clipboard = createCalendarEventClipboard(
      createCalendarEventSelectionSet([makeSource({ id: "event-paste-late" })]),
    );
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents: vi.fn(),
      removeEvent: vi.fn(),
      onSelectEvent: vi.fn(),
      onReconcileSelection: vi.fn(),
      onEventDeleted: vi.fn(),
    }));

    // Let the create resolve and reconcile the optimistic row into a real event.
    await act(async () => {
      await result.current.pasteEvent(clipboard, "2026-04-22");
    });

    // Deleting the reconciled (non-optimistic) event takes the ordinary delete
    // path — a guard that reconciliation does not leave the event flagged optimistic.
    const realEvent = {
      id: "google-created-paste-late",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
      allDay: false,
      isRecurring: false,
      writable: true,
      etag: '"etag-late"',
    };
    await act(async () => {
      result.current.openContextMenu({ event: realEvent, x: 80, y: 80 });
    });
    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-paste-late", expect.objectContaining({
      etag: '"etag-late"',
    }));
  });

  it("deletes only the mid-flight-deleted row's created event in a batch paste", async () => {
    let resolveBatch;
    createCalendarEventsBatch.mockReturnValue(new Promise((resolve) => {
      resolveBatch = resolve;
    }));
    deleteCalendarEvent.mockResolvedValue({});
    const first = makeSource({
      id: "event-batch-a",
      title: "Batch A",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
    });
    const second = makeSource({
      id: "event-batch-b",
      title: "Batch B",
      startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
    });
    const clipboard = createCalendarEventClipboard(createCalendarEventSelectionSet([first, second]));
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onSelectEvent: vi.fn(),
      onEventDeleted: vi.fn(),
    }));

    act(() => {
      result.current.pasteEvent(clipboard, "2026-04-22");
    });
    const optimisticEvents = upsertEvents.mock.calls
      .map(([event]) => event)
      .filter((event) => String(event.id).startsWith("optimistic-calendar-copy-"));
    expect(optimisticEvents).toHaveLength(2);
    const secondOptimistic = optimisticEvents[1];

    // Delete the second row while the batch create is still in flight.
    await act(async () => {
      result.current.openContextMenu({ event: secondOptimistic, x: 80, y: 80 });
    });
    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // Batch resolves — the server created BOTH events.
    await act(async () => {
      resolveBatch({
        created: [
          { index: 0, event: { id: "google-batch-a", accountId: "gmail-main", calendarId: "primary", etag: '"etag-a"', writable: true } },
          { index: 1, event: { id: "google-batch-b", accountId: "gmail-main", calendarId: "primary", etag: '"etag-b"', writable: true } },
        ],
        failed: [],
      });
    });

    // Row #1 upserts as a live event; row #2's created event is deleted on the
    // server (not resurrected), and row #1's is never touched.
    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({ id: "google-batch-a" }));
    expect(upsertEvents).not.toHaveBeenCalledWith(expect.objectContaining({ id: "google-batch-b" }));
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-batch-b", expect.objectContaining({ etag: '"etag-b"' }));
    expect(deleteCalendarEvent).not.toHaveBeenCalledWith("google-batch-a", expect.anything());
  });
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
    const [optimisticId, optimisticDay] = onSelectEvent.mock.calls[0];
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
    const [optimisticId] = onSelectEvent.mock.calls[0];
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
