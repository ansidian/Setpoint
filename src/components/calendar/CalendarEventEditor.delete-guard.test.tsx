import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockDeleteCalendarEvent } from "./CalendarEventEditor.test-setup.ts";
import useCalendarEventEditor from "./events/useCalendarEventEditor";

const WRITABLE_EVENT = {
  id: "event-1",
  etag: '"etag-1"',
  title: "Writable meeting",
  accountId: "gmail-main",
  calendarId: "primary",
  startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
  endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
  writable: true,
  isRecurring: false,
  allDay: false,
};

function renderEditor() {
  return renderHook(() => useCalendarEventEditor({
    open: true,
    view: "events",
    editable: true,
    viewYear: 2026,
    viewMonth: 3,
    selectedDay: 20,
  }));
}

describe("useCalendarEventEditor delete guard", () => {
  it("dispatches a single delete when confirm-delete fires twice in flight", async () => {
    let resolveDelete: ((value: unknown) => void) | undefined;
    mockDeleteCalendarEvent.mockImplementation(
      () => new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );

    const { result } = renderEditor();

    await act(async () => {
      await result.current.openEdit(WRITABLE_EVENT);
    });
    await waitFor(() => {
      expect(result.current.editingEvent).toBeTruthy();
    });

    // Fast double-click on the confirm-delete button: two synchronous
    // remove() invocations before the first delete settles. The disabled
    // state from setDeleting(true) does not flush between these calls, so
    // only the synchronous deletingRef guard can suppress the second.
    await act(async () => {
      result.current.remove();
      result.current.remove();
    });

    expect(mockDeleteCalendarEvent).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete?.({ event: WRITABLE_EVENT });
    });
  });
});
