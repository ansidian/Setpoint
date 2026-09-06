import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOptimisticClipboardPasteEvent, type CalendarQuickActionEvent } from "./calendarQuickActionModel";

// test-architecture: allow-boundary-mock -- Paste-race tests fake the outbound Calendar HTTP adapter while exercising the real optimistic-create reconciliation state machine.
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
  planCalendarEventClipboardPaste,
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
    let submittedClientId!: string;
    let resolveCreate!: (value: unknown) => void;
    const createPromise = new Promise((resolve) => { resolveCreate = resolve; });
    createCalendarEvent.mockImplementation((payload) => {
      submittedClientId = payload.clientEventId;
      return createPromise;
    });
    deleteCalendarEvent.mockResolvedValue({});
    const clipboard = createCalendarEventClipboard(
      createCalendarEventSelectionSet([makeSource({ id: "event-paste-race" })]),
    );
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
    }));

    let pastePromise!: ReturnType<typeof result.current.pasteEvent>;
    act(() => {
      pastePromise = result.current.pasteEvent(clipboard, "2026-04-22");
    });
    const plan = planCalendarEventClipboardPaste(clipboard, "2026-04-22")!;
    const optimisticEvent = buildOptimisticClipboardPasteEvent(plan.items[0]!, 0, submittedClientId);

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

    // test-architecture: allow-boundary-interaction -- Deleting an in-flight paste must never send its temporary client id to the outbound Calendar delete endpoint.
    expect(deleteCalendarEvent).not.toHaveBeenCalledWith(optimisticEvent.id, expect.anything());

    // A create that lands after cancellation must be deleted on Google.
    await act(async () => {
      resolveCreate({
        event: {
          ...optimisticEvent,
          id: "google-created-paste",
          etag: '"etag-paste"',
        },
      });
      await pastePromise;
    });

    // test-architecture: allow-boundary-interaction -- A provider create that lands after cancellation must be compensated with the real id and etag at the outbound Calendar boundary.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-paste", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-paste"',
    }));
  });

  it("deletes only the mid-flight-deleted row's created event in a batch paste", async () => {
    let submittedClientIds!: string[];
    let resolveBatch!: (value: unknown) => void;
    const batchPromise = new Promise((resolve) => { resolveBatch = resolve; });
    createCalendarEventsBatch.mockImplementation((items) => {
      submittedClientIds = items.map((item: { clientEventId: string }) => item.clientEventId);
      return batchPromise;
    });
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
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
    }));

    let pastePromise!: ReturnType<typeof result.current.pasteEvent>;
    act(() => {
      pastePromise = result.current.pasteEvent(clipboard, "2026-04-22");
    });
    const plan = planCalendarEventClipboardPaste(clipboard, "2026-04-22")!;
    const secondOptimistic = buildOptimisticClipboardPasteEvent(plan.items[1]!, 1, submittedClientIds[1]!);

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
      await pastePromise;
    });

    // test-architecture: allow-boundary-interaction -- Only the mid-flight-cancelled batch row may emit a compensating outbound delete with its provider etag.
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-batch-b", expect.objectContaining({ etag: '"etag-b"' }));
    // test-architecture: allow-boundary-interaction -- The live batch row must never be deleted at the outbound provider boundary while its sibling is cancelled.
    expect(deleteCalendarEvent).not.toHaveBeenCalledWith("google-batch-a", expect.anything());
  });
});
