import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockDeleteCalendarEvent } from "./CalendarEventEditor.test-setup.ts";
import { renderModal, openFloatingEventEditorFromSelectedChip } from "./CalendarEventEditor.test-utils.tsx";
import { createDeferred, renderEventEditor } from "./events/CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor create and edit lifecycle", () => {
  it("auto focuses the title when opening the create editor", async () => {
    renderEventEditor();

    const title = await screen.findByTestId("calendar-event-title");
    await waitFor(() => {
      expect(document.activeElement).toBe(title);
    });
  });


  it("deletes an edited single event from the editor action", async () => {
    const event = {
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
      htmlLink: "https://calendar.google.com",
    };
    const deleteRequest = createDeferred();
    mockDeleteCalendarEvent.mockReturnValue(deleteRequest.promise);
    renderEventEditor({ event });
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-delete")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("calendar-event-delete"));

    await waitFor(() => {
      expect(screen.queryByText("Confirm delete")).toBeTruthy();
    });
    const confirmDelete = screen.getByText("Confirm delete");
    fireEvent.click(confirmDelete);
    // The ref guard must reject a second synchronous confirmation before the
    // disabled state has a chance to render.
    fireEvent.click(confirmDelete);
    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Single-event deletion must send account, calendar, and etag to the outbound Calendar API; closed UI state cannot reveal concurrency metadata.
      expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-1", expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-1"',
      }));
    });
    // test-architecture: allow-boundary-interaction -- Double confirmation must still produce exactly one outbound delete; disappearance alone cannot detect duplicate provider writes.
    expect(mockDeleteCalendarEvent).toHaveBeenCalledTimes(1);
    deleteRequest.resolve({ event });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();
    });
    expect(screen.getByTestId("calendar-editor-observed-removals").textContent).toBe('["event-1"]');
    expect(screen.getByTestId("calendar-editor-observed-refreshes").textContent).toBe("[]");
  });


  it("cancels a dirty floating event edit back to the original detail on Escape", async () => {
    renderModal({
      events: [{
        id: "event-1",
        title: "Design review",
        startMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T18:00:00.000Z").getTime(),
        allDay: false,
        color: "#4285f4",
        writable: true,
      }],
      focusDate: "2026-04-20",
    });

    await openFloatingEventEditorFromSelectedChip();
    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Design review revised" },
    });

    fireEvent.keyDown(screen.getByTestId("calendar-event-title"), { key: "Escape", cancelable: true });

    await waitFor(() => {
      const panel = screen.getByTestId("calendar-floating-detail-panel");
      expect(panel.getAttribute("data-floating-mode")).toBe("detail");
      expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();
    });
    expect(screen.getByTestId("calendar-cell-20").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("calendar-cell-1").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("calendar-floating-detail-panel").textContent).toContain("Design review");
  });

  it("cancels the editor on browser back", async () => {
    renderEventEditor();
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();
    });
  });
});
