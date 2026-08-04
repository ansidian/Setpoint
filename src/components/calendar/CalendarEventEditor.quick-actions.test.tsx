import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  mockCreateCalendarEvent,
  mockCreateCalendarEventsBatch,
  mockUpdateCalendarEvent,
  mockDeleteCalendarEvent,
} from "./CalendarEventEditor.test-setup.ts";
import { renderModal, createDataTransfer, createDeferred } from "./CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor quick action behavior", () => {
  it("reschedules a writable event by drag-drop with an optimistic cache update", async () => {
    const event = {
      id: "event-drag-1",
      etag: '"etag-drag-1"',
      title: "Move me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockUpdateCalendarEvent.mockResolvedValue({
      event: {
        ...event,
        startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-21T17:30:00.000Z").getTime(),
      },
    });
    renderModal({ events: [event] });
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(screen.getByTestId("calendar-cell-item-chip"), { dataTransfer });
    fireEvent.drop(screen.getByTestId("calendar-cell-21"), { dataTransfer });

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Drag rescheduling must emit an outbound Calendar update for the persisted event identity; rendered placement alone cannot prove the write occurred.
      expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-drag-1", expect.any(Object));
    });
    expect(within(screen.getByTestId("calendar-cell-21")).getByText("Move me")).toBeTruthy();
  });

  it("uses the quick-action context menu to delete a writable event", async () => {
    const event = {
      id: "event-context-delete",
      etag: '"etag-context-delete"',
      title: "Delete me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockDeleteCalendarEvent.mockResolvedValue(undefined);
    renderModal({ events: [event] });

    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });
    expect(await screen.findByTestId("calendar-event-context-copy")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-context-duplicate")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-color-grid")).toBeTruthy();
    fireEvent.click(await screen.findByTestId("calendar-event-context-delete"));
    fireEvent.click(screen.getByTestId("calendar-event-context-confirm-delete"));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Context deletion must send the event identity and etag across the outbound Calendar API boundary.
      expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-context-delete", {
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-context-delete"',
      });
    });
    await waitFor(() => expect(screen.queryByTestId("calendar-cell-item-chip")).toBeNull());
  });

  it("opens the color-aware context menu from all-day span events", async () => {
    const event = {
      id: "event-all-day-source-color",
      etag: '"etag-all-day-source-color"',
      title: "All day source color",
      accountId: "gmail-main",
      calendarId: "work",
      startMs: new Date("2026-04-20T19:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T19:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: true,
      sourceColor: "#4285f4",
      color: "#4285f4",
      colorId: null,
    };
    renderModal({ events: [event] });

    fireEvent.contextMenu(await screen.findByTestId("calendar-event-span-segment"), {
      clientX: 140,
      clientY: 180,
    });

    // Integration concern this test owns: the context menu opens from an all-day
    // span segment (not just a cell chip). The color-dot aria-pressed/check
    // contract is asserted at the focused layer in CalendarQuickActionLayer.test.tsx.
    expect(await screen.findByTestId("calendar-event-color-grid")).toBeTruthy();
  });

  it("duplicates a writable event from the quick-action context menu", async () => {
    const event = {
      id: "event-context-duplicate",
      etag: '"etag-context-duplicate"',
      title: "Duplicate me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      allDay: false,
      location: "Office",
      description: "Notes",
      colorId: "9",
    };
    const created = {
      ...event,
      id: "event-context-duplicate-copy",
      isRecurring: false,
      recurringEventId: null,
      originalStartTime: null,
    };
    const deferred = createDeferred();
    mockCreateCalendarEvent.mockReturnValue(deferred.promise);
    renderModal({ events: [event] });

    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId("calendar-event-context-duplicate"));

    expect(screen.getAllByTestId("calendar-cell-item-chip")).toHaveLength(2);

    deferred.resolve({ event: created });

    // Field-by-field clone payload (startDate/startTime/colorId) is locked at the
    // pure layer in calendarQuickActionModel.test.js (buildCloneEventPayload). Here we only assert Duplicate reaches the create boundary.
    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Duplicate must cross the outbound single-create Calendar boundary; optimistic rendered state exists before provider acceptance.
      expect(mockCreateCalendarEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Duplicate me" }),
      );
    });
    expect(screen.getAllByTestId("calendar-cell-item-chip")).toHaveLength(2);
  });

  it("updates event color from the quick-action context menu", async () => {
    const event = {
      id: "event-context-color",
      etag: '"etag-context-color"',
      title: "Color me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
      color: "#4285f4",
    };
    mockUpdateCalendarEvent.mockResolvedValue({
      event: { ...event, colorId: "11", color: "#dc2127" },
    });
    renderModal({ events: [event] });

    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId("calendar-event-color-11"));

    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Color changes require the account, calendar, and color id on the outbound Calendar update request.
      expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-context-color", expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
        colorId: "11",
      }));
    });
    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), { clientX: 140, clientY: 180 });
    expect((await screen.findByTestId("calendar-event-color-11")).getAttribute("aria-pressed")).toBe("true");
  });

  it("scopes selected context Copy to the Calendar Event Selection Set", async () => {
    const early = {
      id: "event-context-copy-early",
      title: "Copy early",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    const later = {
      id: "event-context-copy-later",
      title: "Copy later",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T18:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    renderModal({ events: [later, early] });

    const earlyChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    const laterChip = within(screen.getByTestId("calendar-cell-21")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(laterChip, { metaKey: true });
    fireEvent.click(earlyChip, { metaKey: true });
    fireEvent.contextMenu(earlyChip, { clientX: 140, clientY: 180 });

    const copyButton = await screen.findByTestId("calendar-event-context-copy");
    expect(copyButton.textContent).toMatch(/copy 2 events/i);
    fireEvent.click(copyButton);
    fireEvent.click(screen.getByTestId("calendar-cell-23"));
    fireEvent.keyDown(document, { key: "v", metaKey: true });

    // The per-item batch field map (startDate/startTime/colorId) is locked at the
    // pure layer in useCalendarQuickActions.test.js (clone-race batch test, lines
    // 453-469). The behavior this integration test owns is the routing: a
    // multi-event selection copy reaches the BATCH boundary (not single create),
    // carrying both events in chronological order.
    await waitFor(() => {
      // test-architecture: allow-boundary-interaction -- Multi-selection Copy must use the outbound batch endpoint with both events in chronological order; UI state cannot distinguish the provider endpoint used.
      expect(mockCreateCalendarEventsBatch).toHaveBeenCalledWith([
        expect.objectContaining({ title: "Copy early" }),
        expect.objectContaining({ title: "Copy later" }),
      ]);
    });
  });

  it("confirms and deletes the selected context scope as occurrence-only before clearing the set", async () => {
    const recurring = {
      id: "event-context-delete-recurring",
      etag: '"etag-context-delete-recurring"',
      title: "Recurring delete",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: true,
      recurringEventId: "series-delete",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      allDay: false,
    };
    const oneOff = {
      id: "event-context-delete-one-off",
      etag: '"etag-context-delete-one-off"',
      title: "One-off delete",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T18:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockDeleteCalendarEvent.mockResolvedValue({});
    renderModal({ events: [recurring, oneOff] });

    const recurringChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    const oneOffChip = within(screen.getByTestId("calendar-cell-21")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(recurringChip, { metaKey: true });
    fireEvent.click(oneOffChip, { metaKey: true });
    fireEvent.contextMenu(recurringChip, { clientX: 140, clientY: 180 });
    fireEvent.click(await screen.findByTestId("calendar-event-context-delete"));

    expect(await screen.findByText("Delete 2 events?")).toBeTruthy();
    expect(screen.queryByTestId("calendar-quick-action-scope-prompt")).toBeNull();

    fireEvent.click(screen.getByTestId("calendar-event-context-confirm-delete"));

    await waitFor(() => expect(screen.queryAllByTestId("calendar-cell-item-chip")).toHaveLength(0));
    // test-architecture: allow-boundary-interaction -- Batch deletion of a recurring selection must send occurrence-only scope and series identity to the outbound Calendar API.
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-context-delete-recurring", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-context-delete-recurring"',
      scope: "one",
      recurringEventId: "series-delete",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    }));
    // test-architecture: allow-boundary-interaction -- The one-off member of a mixed deletion batch must send its own account, calendar, and etag to the outbound Calendar API.
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-context-delete-one-off", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-context-delete-one-off"',
    }));
  });

  it("opens batch delete confirmation from Delete without deleting immediately", async () => {
    const first = {
      id: "event-key-delete-first",
      title: "Keyboard delete first",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    const second = {
      id: "event-key-delete-second",
      title: "Keyboard delete second",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T18:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    renderModal({ events: [first, second] });

    fireEvent.click(within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip"), { metaKey: true });
    fireEvent.click(within(screen.getByTestId("calendar-cell-21")).getByTestId("calendar-cell-item-chip"), { metaKey: true });
    fireEvent.keyDown(document, { key: "Delete" });

    expect(await screen.findByText("Delete 2 events?")).toBeTruthy();
  });

  it("keeps single recurring context Delete on the existing recurrence scope prompt outside batch mode", async () => {
    const recurring = {
      id: "event-context-delete-recurring-single",
      etag: '"etag-context-delete-recurring-single"',
      title: "Recurring single delete",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: true,
      recurringEventId: "series-single-delete",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      allDay: false,
    };
    renderModal({ events: [recurring] });

    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), { clientX: 140, clientY: 180 });
    fireEvent.click(await screen.findByTestId("calendar-event-context-delete"));

    expect(await screen.findByTestId("calendar-quick-action-scope-prompt")).toBeTruthy();
    expect(screen.getByText("Delete recurring event")).toBeTruthy();
  });
});
