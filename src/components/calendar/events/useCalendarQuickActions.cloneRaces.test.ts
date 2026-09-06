import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOptimisticCloneEvent } from "./calendarQuickActionModel";

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
const { default: useCalendarQuickActions } = await import("./useCalendarQuickActions");
const {
  createCalendarEventClipboard,
  createCalendarEventSelectionSet,
} = await import("./calendarEventSelectionModel");

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCalendarQuickActions clone races", () => {
  it("reports partial batch paste failure without retrying the batch", async () => {
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
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
    }));

    await act(async () => {
      await result.current.pasteEvent(clipboard, "2026-06-01");
    });

    // test-architecture: allow-boundary-interaction -- Multi-item paste must issue exactly one outbound batch create; cache state cannot reveal duplicate provider writes or endpoint selection.
    expect(createCalendarEventsBatch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual({ tone: "error", message: "Pasted 1, failed 1." });
  });

  it("treats deleting a pending optimistic clone as cancellation until the provider create reconciles", async () => {
    let submittedClientId!: string;
    let resolveCreate!: (value: unknown) => void;
    const createPromise = new Promise((resolve) => { resolveCreate = resolve; });
    createCalendarEvent.mockImplementation((payload) => {
      submittedClientId = payload.clientEventId;
      return createPromise;
    });
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
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
    }));

    let pastePromise!: ReturnType<typeof result.current.pasteEvent>;
    act(() => {
      pastePromise = result.current.pasteEvent(sourceEvent, "2026-04-22");
    });

    const optimisticEvent = buildOptimisticCloneEvent(sourceEvent, "2026-04-22", submittedClientId);

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

    await act(async () => {
      resolveCreate({
        event: {
          ...optimisticEvent,
          id: "google-created-copy",
          etag: '"etag-created-copy"',
        },
      });
      await pastePromise;
    });

    // test-architecture: allow-boundary-interaction -- Once the provider create lands after cancellation, the real id and etag must be sent to the outbound compensating delete.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-copy", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-created-copy"',
    }));
  });

  it("deletes the reconciled event when a temp clone menu confirms after create resolves", async () => {
    let submittedClientId!: string;
    let resolveCreate!: (value: unknown) => void;
    const createPromise = new Promise((resolve) => { resolveCreate = resolve; });
    createCalendarEvent.mockImplementation((payload) => {
      submittedClientId = payload.clientEventId;
      return createPromise;
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
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
    }));

    let pastePromise!: ReturnType<typeof result.current.pasteEvent>;
    act(() => {
      pastePromise = result.current.pasteEvent(sourceEvent, "2026-04-22");
    });

    const optimisticEvent = buildOptimisticCloneEvent(sourceEvent, "2026-04-22", submittedClientId);
    await act(async () => {
      result.current.openContextMenu({ event: optimisticEvent, x: 80, y: 80 });
    });
    await act(async () => {
      resolveCreate({
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
      await pastePromise;
    });

    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // test-architecture: allow-boundary-interaction -- A menu opened on a temporary row must delete the reconciled provider id with its etag across the outbound Calendar boundary.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-copy-late-delete", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-late-delete"',
    }));
  });
});
