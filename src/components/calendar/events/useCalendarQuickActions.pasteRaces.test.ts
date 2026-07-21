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

describe("useCalendarQuickActions clipboard paste delete-during-create race", () => {
  function makeSource(
    overrides: Partial<CalendarQuickActionEvent> & Pick<CalendarQuickActionEvent, "id">,
  ): CalendarQuickActionEvent {
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
    let resolveCreate!: (value: unknown) => void;
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
    const optimisticEvent = upsertEvents.mock.calls[0]![0];
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
    let resolveBatch!: (value: unknown) => void;
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
