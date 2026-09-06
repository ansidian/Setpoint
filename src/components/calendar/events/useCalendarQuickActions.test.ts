import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarQuickActionEvent } from "./calendarQuickActionModel";

// test-architecture: allow-boundary-mock -- The quick-action state machine runs against a fake Calendar HTTP adapter so race/error tests cannot mutate the real provider.
vi.mock("@/api", () => ({
  createCalendarEvent: vi.fn(),
  createCalendarEventsBatch: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  getCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

const api = await import("@/api");
const createCalendarEvent = api.createCalendarEvent as ReturnType<typeof vi.fn>;
const deleteCalendarEvent = api.deleteCalendarEvent as ReturnType<typeof vi.fn>;
const getCalendarEvent = api.getCalendarEvent as ReturnType<typeof vi.fn>;
const updateCalendarEvent = api.updateCalendarEvent as ReturnType<typeof vi.fn>;
const { default: useCalendarQuickActions } = await import("./useCalendarQuickActions");
const { default: useCalendarEventQuickActionMutations } = await import("./useCalendarEventQuickActionMutations");
const {
  createCalendarEventClipboard,
  createCalendarEventSelectionSet,
} = await import("./calendarEventSelectionModel");

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  getCalendarEvent.mockResolvedValue({ event: null });
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

  it("continues the remaining provider deletes after a failure and reports partial failure", async () => {
    const keep = makeEvent({ id: "event-keep", etag: '"etag-keep"' });
    const drop = makeEvent({ id: "event-drop", etag: '"etag-drop"' });
    deleteCalendarEvent.mockImplementation((id) => (
      id === "event-drop"
        ? Promise.resolve({})
        : Promise.reject(new Error("Provider rejected delete."))
    ));
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
    }));

    act(() => {
      result.current.requestBatchDelete({ events: [keep, drop], x: 80, y: 80 });
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // Both deletes were attempted — the loop did not abort after "event-keep" failed.
    // test-architecture: allow-boundary-interaction -- Partial failure must still attempt the first outbound Calendar delete; result state does not identify every provider request attempted.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("event-keep", expect.anything());
    // test-architecture: allow-boundary-interaction -- Partial failure must continue to the second outbound Calendar delete after the first rejects.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("event-drop", expect.anything());
    expect(result.current.contextMenu).toMatchObject({
      busy: false,
      error: "Deleted 1, failed 1.",
    });
  });

  it("reports batch deletion failure after attempting every provider delete", async () => {
    const a = makeEvent({ id: "event-a", etag: '"etag-a"' });
    const b = makeEvent({ id: "event-b", etag: '"etag-b"' });
    deleteCalendarEvent.mockRejectedValue(new Error("All deletes failed."));
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
    }));

    act(() => {
      result.current.requestBatchDelete({ events: [a, b], x: 80, y: 80 });
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    // test-architecture: allow-boundary-interaction -- The all-failure case must attempt both outbound provider deletes rather than aborting after the first rejection.
    expect(deleteCalendarEvent).toHaveBeenCalledTimes(2);
    expect(result.current.contextMenu).toMatchObject({
      busy: false,
      error: "All deletes failed.",
    });
  });
});

describe("useCalendarQuickActions delete timeout verification", () => {
  it("verifies a timed-out deletion with Google before reporting success", async () => {
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
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
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

    // A transport timeout is ambiguous; verify the provider result before reporting success.
    expect(result.current.status).toEqual({ tone: "success", message: "Event deleted." });
    // test-architecture: allow-boundary-interaction -- Timeout recovery must query the exact provider event identity before treating the optimistic delete as confirmed.
    expect(getCalendarEvent).toHaveBeenCalledWith("event-timeout", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
    }));
  });
});

describe("useCalendarQuickActions same-event mutation ordering", () => {
  it("starts the second reschedule only after the first one settles", async () => {
    const first = createDeferred<{ event: CalendarQuickActionEvent }>();
    const second = createDeferred<{ event: CalendarQuickActionEvent }>();
    updateCalendarEvent
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const event = {
      id: "event-rapid-move",
      title: "Rapid move",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      allDay: false,
      isRecurring: false,
      writable: true,
      etag: '"etag-rapid-move"',
    };
    const { result } = renderHook(() => useCalendarEventQuickActionMutations({
      editable: true,
      handlers: {},
    }));

    let firstMutation!: Promise<void>;
    let secondMutation!: Promise<void>;
    act(() => {
      firstMutation = result.current.runReschedule({ event, targetDate: "2026-04-21" });
      secondMutation = result.current.runReschedule({ event, targetDate: "2026-04-22" });
    });

    // test-architecture: allow-boundary-interaction -- Same-event writes must be serialized at the outbound Calendar boundary; rendered optimistic state cannot prove the second provider request remained queued.
    expect(updateCalendarEvent).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({
        event: {
          ...event,
          startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
          endMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
        },
      });
      await firstMutation;
    });
    // test-architecture: allow-boundary-interaction -- The queued reschedule must start at the outbound Calendar boundary after the first provider write settles; hook state cannot prove dispatch order.
    expect(updateCalendarEvent).toHaveBeenCalledTimes(2);
    // test-architecture: allow-boundary-interaction -- The second serialized provider write must carry the later requested date; optimistic state cannot prove which request reached Google.
    expect(updateCalendarEvent).toHaveBeenNthCalledWith(
      2,
      "event-rapid-move",
      expect.objectContaining({ startDate: "2026-04-22" }),
    );

    await act(async () => {
      second.resolve({
        event: {
          ...event,
          startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
          endMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
        },
      });
      await secondMutation;
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
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
    }));

    await act(async () => {
      await result.current.pasteEvent(clipboard, "2026-04-22");
    });

    expect(result.current.status).toEqual({ tone: "error", message: "Provider down." });
  });
});
