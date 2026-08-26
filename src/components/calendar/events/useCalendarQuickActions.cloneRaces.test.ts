import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarQuickActionEvent } from "./calendarQuickActionModel";

// test-architecture: allow-boundary-mock -- Clone-race tests replace only the outbound Calendar HTTP adapter; the real quick-action state machine and policy models run together.
vi.mock("@/api", () => ({
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  getCalendarEvent: vi.fn(),
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
  function createObservedHandlers() {
    const state = {
      upserts: [] as CalendarQuickActionEvent[],
      removals: [] as Array<string | number>,
      selections: [] as Array<[string | null, string]>,
      reconciliations: [] as Array<[string | null, string | null]>,
      deleted: [] as Array<[string | null, CalendarQuickActionEvent]>,
    };
    return {
      state,
      handlers: {
        upsertEvents: (input: CalendarQuickActionEvent | CalendarQuickActionEvent[]) => {
          state.upserts.push(...(Array.isArray(input) ? input : [input]));
        },
        removeEvent: (id: string | number | null | undefined) => {
          if (id !== null && id !== undefined) state.removals.push(id);
        },
        onSelectEvent: (id: string | null, day: string) => {
          state.selections.push([id, day]);
        },
        onReconcileSelection: (before: string | null, after: string | null) => {
          state.reconciliations.push([before, after]);
        },
        onEventDeleted: (id: string | null, event: CalendarQuickActionEvent) => {
          state.deleted.push([id, event]);
        },
      },
    };
  }

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
    const observed = createObservedHandlers();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      ...observed.handlers,
    }));

    await act(async () => {
      await result.current.pasteEvent(clipboard, "2026-06-01");
    });

    // test-architecture: allow-boundary-interaction -- Multi-item paste must issue exactly one outbound batch create; cache state cannot reveal duplicate provider writes or endpoint selection.
    expect(createCalendarEventsBatch).toHaveBeenCalledTimes(1);
    const optimisticEvents = observed.state.upserts
      .filter((event) => event._optimisticCalendarClone === true);
    expect(optimisticEvents).toHaveLength(2);
    expect(observed.state.removals).toEqual(expect.arrayContaining([optimisticEvents[0]!.id, optimisticEvents[1]!.id]));
    expect(observed.state.upserts.map((event) => event.id)).toContain("google-created-first");
    // The optimistic select moved the day once; the reconcile only swaps the id of
    // the first optimistic row for its real server id, without re-asserting the day.
    expect(observed.state.selections).toEqual([[optimisticEvents[0]!.id as string, "2026-06-01"]]);
    expect(observed.state.reconciliations).toContainEqual([optimisticEvents[0]!.id, "google-created-first"]);
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
    const observed = createObservedHandlers();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      ...observed.handlers,
    }));

    act(() => {
      result.current.pasteEvent(sourceEvent, "2026-04-22");
    });

    const optimisticEvent = observed.state.upserts[0]!;
    expect(optimisticEvent).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{28,32}$/),
      _optimisticCalendarClone: true,
    });

    await act(async () => {
      result.current.openContextMenu({ event: optimisticEvent, x: 80, y: 80 });
    });
    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // test-architecture: allow-boundary-interaction -- Cancelling an in-flight optimistic clone must not send its temporary client id to the outbound Calendar delete API.
    expect(deleteCalendarEvent).not.toHaveBeenCalledWith(optimisticEvent.id, expect.anything());
    expect(observed.state.removals).toContain(optimisticEvent.id);

    await act(async () => {
      resolveCreate({
        event: {
          ...optimisticEvent,
          id: "google-created-copy",
          etag: '"etag-created-copy"',
        },
      });
    });

    expect(observed.state.upserts.map((event) => event.id)).not.toContain("google-created-copy");
    // test-architecture: allow-boundary-interaction -- Once the provider create lands after cancellation, the real id and etag must be sent to the outbound compensating delete.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-copy", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-created-copy"',
    }));
    expect(observed.state.deleted).toContainEqual([optimisticEvent.id, optimisticEvent]);
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
    const observed = createObservedHandlers();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      ...observed.handlers,
    }));

    act(() => {
      result.current.pasteEvent(sourceEvent, "2026-04-22");
    });

    const optimisticEvent = observed.state.upserts[0]!;
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

    expect(observed.state.removals).toContain("google-created-copy-late-delete");
    // test-architecture: allow-boundary-interaction -- A menu opened on a temporary row must delete the reconciled provider id with its etag across the outbound Calendar boundary.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-copy-late-delete", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-late-delete"',
    }));
    expect(observed.state.deleted.map(([id]) => id)).toContain("google-created-copy-late-delete");
  });
});
