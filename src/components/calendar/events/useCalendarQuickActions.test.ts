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

describe("useCalendarQuickActions batch delete partial failure", () => {
  function makeEvent(
    overrides: Partial<CalendarQuickActionEvent> & Pick<CalendarQuickActionEvent, "id">,
  ): CalendarQuickActionEvent {
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
    const prunedIds = onBatchDeleted.mock.calls[0]![0].map((event: { id: unknown }) => event.id);
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
    expect(result.current.status?.message).toContain("timed out");
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

    const optimisticEvent = upsertEvents.mock.calls[0]![0];
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvent.id);
    expect(result.current.status).toEqual({ tone: "error", message: "Failed to paste event." });
  });
});
