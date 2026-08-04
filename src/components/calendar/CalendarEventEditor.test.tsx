import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

  it("opens event create as a compact Todoist-style icon composer", async () => {
    renderEventEditor();

    const rail = await screen.findByTestId("calendar-event-editor-rail");
    expect(rail.getAttribute("data-editor-layout")).toBe("slim-icon");
    const toolbar = screen.getByTestId("calendar-event-compact-toolbar");
    expect(toolbar).toBeTruthy();
    expect(screen.getByTestId("calendar-event-description")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-description").getAttribute("data-compact-notes")).toBe("true");
    expect(screen.queryByTestId("calendar-event-notes-chip")).toBeNull();
    expect(screen.queryByTestId("calendar-event-editor-detail-layout")).toBeNull();

    [
      "calendar-event-schedule-trigger",
      "calendar-event-source-trigger",
      "calendar-event-location-trigger",
      "calendar-event-repeat-trigger",
    ].forEach((testId) => {
      const button = screen.getByTestId(testId);
      expect(button.textContent.trim()).toBe("");
      expect(button.getAttribute("title")).toBeNull();
      expect(button.getAttribute("aria-label")).toBeTruthy();
    });
    expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 20, 2026/i);
    expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/personal/i);
    expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/does not repeat/i);
    expect(screen.getByTestId("calendar-event-save")).toBeTruthy();
  });

  it("opens compact popovers from the icon action row one at a time", async () => {
    renderEventEditor();
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-source-trigger")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("calendar-event-source-trigger"));
    expect(await screen.findByRole("dialog", { name: /calendar source picker/i })).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-schedule-trigger"));
    const schedulePicker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    expect(schedulePicker).toBeTruthy();
    expect(within(schedulePicker).getByTestId("calendar-compact-schedule-summary").textContent).toMatch(/apr 20, 2026/i);
    expect((within(schedulePicker).getByLabelText("All day") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("dialog", { name: /calendar source picker/i })).toBeNull();

    fireEvent.click(screen.getByTestId("calendar-event-title"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /compact schedule picker/i })).toBeNull();
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
    const { refreshRange, removeEvent } = renderEventEditor({ event });
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-delete")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("calendar-event-delete"));
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByText("Confirm delete")).toBeTruthy();
    });
    const confirmDelete = screen.getByText("Confirm delete");
    fireEvent.click(confirmDelete);
    // The ref guard must reject a second synchronous confirmation before the
    // disabled state has a chance to render.
    fireEvent.click(confirmDelete);
    await waitFor(() => {
      expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-1", {
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-1"',
      });
    });
    expect(mockDeleteCalendarEvent.mock.calls).toHaveLength(1);
    deleteRequest.resolve({ event });
    await waitFor(() => {
      expect(screen.queryByTestId("calendar-event-editor-rail")).toBeNull();
    });
    expect(removeEvent).toHaveBeenCalledWith("event-1");
    expect(refreshRange).not.toHaveBeenCalled();
  });

  it("dismisses open floating detail after a successful context-menu copy", async () => {
    const event = {
      id: "event-context-copy-detail",
      etag: '"etag-context-copy-detail"',
      title: "Copy closes detail",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    renderModal({ events: [event] });

    const chip = screen.getByTestId("calendar-cell-item-chip");
    fireEvent.click(chip);
    expect(await screen.findByTestId("calendar-floating-detail-panel")).toBeTruthy();

    fireEvent.contextMenu(chip, {
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId("calendar-event-context-copy"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-floating-detail-panel")).toBeNull();
    });
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
