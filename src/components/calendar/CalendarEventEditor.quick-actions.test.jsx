import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  mockCreateCalendarEvent,
  mockCreateCalendarEventsBatch,
  mockUpdateCalendarEvent,
  mockDeleteCalendarEvent,
} from "./CalendarEventEditor.test-setup.js";
import { renderModal, createDataTransfer, createDeferred } from "./CalendarEventEditor.test-utils.jsx";

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
    const { upsertEvents } = renderModal({ events: [event] });
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(screen.getByTestId("calendar-cell-item-chip"), { dataTransfer });
    fireEvent.drop(screen.getByTestId("calendar-cell-21"), { dataTransfer });

    await waitFor(() => {
      expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-drag-1", expect.any(Object));
    });
    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({
      id: "event-drag-1",
      startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
    }));
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
    const { removeEvent } = renderModal({ events: [event] });

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
      expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-context-delete", {
        accountId: "gmail-main",
        calendarId: "primary",
        etag: '"etag-context-delete"',
      });
    });
    expect(removeEvent).toHaveBeenCalledWith("event-context-delete");
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
    // contract is asserted at the focused layer in CalendarQuickActionLayer.test.jsx.
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
    const { upsertEvents } = renderModal({ events: [event] });

    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId("calendar-event-context-duplicate"));

    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^optimistic-calendar-copy-event-context-duplicate-/),
      title: "Duplicate me",
      startMs: event.startMs,
      endMs: event.endMs,
      isRecurring: false,
      colorId: "9",
    }));

    deferred.resolve({ event: created });

    // Field-by-field clone payload (startDate/startTime/colorId) is locked at the
    // pure layer in calendarQuickActionModel.test.js (buildCloneEventPayload). Here we only assert Duplicate reaches the create boundary.
    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Duplicate me" }),
      );
    });
    expect(upsertEvents).toHaveBeenCalledWith(created);
  });

  it("copies the selected event with Cmd+C and pastes it onto the selected day with Cmd+V", async () => {
    const event = {
      id: "event-hotkey-copy",
      etag: '"etag-hotkey-copy"',
      title: "Copy with keys",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      writable: true,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      allDay: false,
      location: "Office",
      description: "Notes",
      colorId: "7",
    };
    const created = {
      ...event,
      id: "event-hotkey-copy-created",
      startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T17:30:00.000Z").getTime(),
      isRecurring: false,
      recurringEventId: null,
      originalStartTime: null,
    };
    const deferred = createDeferred();
    mockCreateCalendarEvent.mockReturnValue(deferred.promise);
    const { upsertEvents } = renderModal({ events: [event] });

    fireEvent.click(screen.getByTestId("calendar-cell-item-chip"));
    fireEvent.keyDown(document, { key: "c", metaKey: true });
    fireEvent.click(screen.getByTestId("calendar-cell-21"));
    fireEvent.keyDown(document, { key: "v", metaKey: true });

    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^optimistic-calendar-copy-clipboard-0-/),
      title: "Copy with keys",
      startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T17:30:00.000Z").getTime(),
      isRecurring: false,
      colorId: "7",
    }));

    deferred.resolve({ event: created });

    // The pasted clone's field map (startDate/startTime/colorId) is locked at the
    // pure layer in calendarQuickActionModel.test.js (buildCloneEventPayload). Here we only assert Cmd+V reaches the single-item create boundary.
    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Copy with keys" }),
      );
    });
    expect(upsertEvents).toHaveBeenCalledWith(created);
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
    const { upsertEvents } = renderModal({ events: [event] });

    fireEvent.contextMenu(screen.getByTestId("calendar-cell-item-chip"), {
      clientX: 140,
      clientY: 180,
    });
    fireEvent.click(await screen.findByTestId("calendar-event-color-11"));

    await waitFor(() => {
      expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-context-color", expect.objectContaining({
        accountId: "gmail-main",
        calendarId: "primary",
        colorId: "11",
      }));
    });
    expect(upsertEvents).toHaveBeenCalledWith(expect.objectContaining({
      id: "event-context-color",
      colorId: "11",
      color: "#dc2127",
    }));
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
      expect(mockCreateCalendarEventsBatch).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateCalendarEventsBatch).toHaveBeenCalledWith([
      expect.objectContaining({ title: "Copy early" }),
      expect.objectContaining({ title: "Copy later" }),
    ]);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("scopes outside context Copy to only the context event without disturbing the existing selection set", async () => {
    const selected = {
      id: "event-context-copy-selected",
      title: "Selected copy member",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    const outside = {
      id: "event-context-copy-outside",
      title: "Outside copy target",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-22T18:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        ...outside,
        id: "event-context-copy-outside-created",
        startMs: new Date("2026-04-23T17:00:00.000Z").getTime(),
        endMs: new Date("2026-04-23T18:00:00.000Z").getTime(),
      },
    });
    renderModal({ events: [selected, outside] });

    const selectedChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    const outsideChip = within(screen.getByTestId("calendar-cell-22")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(selectedChip, { metaKey: true });
    fireEvent.contextMenu(outsideChip, { clientX: 140, clientY: 180 });

    const copyButton = await screen.findByTestId("calendar-event-context-copy");
    expect(copyButton.textContent).toBe("Copy");
    fireEvent.click(copyButton);
    expect(selectedChip.getAttribute("data-calendar-event-selection")).toBe("true");
    fireEvent.click(screen.getByTestId("calendar-cell-23"));
    fireEvent.keyDown(document, { key: "v", metaKey: true });

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: "Outside copy target",
      startDate: "2026-04-23",
    }));
    expect(mockCreateCalendarEventsBatch).not.toHaveBeenCalled();
  });

  it("colors the selected context scope as occurrence-only without clearing the selection set", async () => {
    const recurring = {
      id: "event-context-color-recurring",
      title: "Recurring color",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: true,
      recurringEventId: "series-color",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      allDay: false,
    };
    const oneOff = {
      id: "event-context-color-one-off",
      title: "One-off color",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T18:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    const byId = new Map([[recurring.id, recurring], [oneOff.id, oneOff]]);
    mockUpdateCalendarEvent.mockImplementation((id, payload) => Promise.resolve({
      event: {
        ...byId.get(id),
        colorId: payload.colorId,
        color: "#dc2127",
      },
    }));
    renderModal({ events: [recurring, oneOff] });

    const recurringChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    const oneOffChip = within(screen.getByTestId("calendar-cell-21")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(recurringChip, { metaKey: true });
    fireEvent.click(oneOffChip, { metaKey: true });
    fireEvent.contextMenu(recurringChip, { clientX: 140, clientY: 180 });
    fireEvent.click(await screen.findByTestId("calendar-event-color-11"));

    await waitFor(() => {
      expect(mockUpdateCalendarEvent).toHaveBeenCalledTimes(2);
    });
    expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-context-color-recurring", expect.objectContaining({
      colorId: "11",
      scope: "one",
      recurringEventId: "series-color",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    }));
    expect(mockUpdateCalendarEvent).toHaveBeenCalledWith("event-context-color-one-off", expect.objectContaining({
      colorId: "11",
    }));
    expect(screen.queryByTestId("calendar-quick-action-scope-prompt")).toBeNull();
    expect(recurringChip.getAttribute("data-calendar-event-selection")).toBe("true");
    expect(oneOffChip.getAttribute("data-calendar-event-selection")).toBe("true");
  });

  it("keeps Duplicate scoped to the context event even when it is selected", async () => {
    const contextEvent = {
      id: "event-context-duplicate-selected",
      title: "Duplicate selected context",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    const otherSelectedEvent = {
      id: "event-context-duplicate-other",
      title: "Do not duplicate",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-21T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T18:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        ...contextEvent,
        id: "event-context-duplicate-selected-copy",
      },
    });
    renderModal({ events: [contextEvent, otherSelectedEvent] });

    const contextChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    const otherChip = within(screen.getByTestId("calendar-cell-21")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(contextChip, { metaKey: true });
    fireEvent.click(otherChip, { metaKey: true });
    fireEvent.contextMenu(contextChip, { clientX: 140, clientY: 180 });
    fireEvent.click(await screen.findByTestId("calendar-event-context-duplicate"));

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: "Duplicate selected context",
    }));
    expect(mockCreateCalendarEvent.mock.calls[0][0]).not.toMatchObject({
      title: "Do not duplicate",
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
    const { removeEvent } = renderModal({ events: [recurring, oneOff] });

    const recurringChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    const oneOffChip = within(screen.getByTestId("calendar-cell-21")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(recurringChip, { metaKey: true });
    fireEvent.click(oneOffChip, { metaKey: true });
    fireEvent.contextMenu(recurringChip, { clientX: 140, clientY: 180 });
    fireEvent.click(await screen.findByTestId("calendar-event-context-delete"));

    expect(await screen.findByText("Delete 2 events?")).toBeTruthy();
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(screen.queryByTestId("calendar-quick-action-scope-prompt")).toBeNull();

    fireEvent.click(screen.getByTestId("calendar-event-context-confirm-delete"));

    await waitFor(() => {
      expect(mockDeleteCalendarEvent).toHaveBeenCalledTimes(2);
    });
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-context-delete-recurring", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-context-delete-recurring"',
      scope: "one",
      recurringEventId: "series-delete",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    }));
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-context-delete-one-off", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-context-delete-one-off"',
    }));
    expect(removeEvent).toHaveBeenCalledWith("event-context-delete-recurring");
    expect(removeEvent).toHaveBeenCalledWith("event-context-delete-one-off");
    await waitFor(() => {
      expect(recurringChip.getAttribute("data-calendar-event-selection")).toBeNull();
      expect(oneOffChip.getAttribute("data-calendar-event-selection")).toBeNull();
    });
  });

  it("keeps outside-set context Delete scoped to only the context event", async () => {
    const selected = {
      id: "event-context-delete-selected",
      etag: '"etag-context-delete-selected"',
      title: "Selected delete member",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    const outside = {
      id: "event-context-delete-outside",
      etag: '"etag-context-delete-outside"',
      title: "Outside delete target",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-22T17:00:00.000Z").getTime(),
      endMs: new Date("2026-04-22T18:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    mockDeleteCalendarEvent.mockResolvedValue({});
    renderModal({ events: [selected, outside] });

    const selectedChip = within(screen.getByTestId("calendar-cell-20")).getByTestId("calendar-cell-item-chip");
    const outsideChip = within(screen.getByTestId("calendar-cell-22")).getByTestId("calendar-cell-item-chip");
    fireEvent.click(selectedChip, { metaKey: true });
    fireEvent.contextMenu(outsideChip, { clientX: 140, clientY: 180 });
    fireEvent.click(await screen.findByTestId("calendar-event-context-delete"));

    expect(await screen.findByText("Delete this event?")).toBeTruthy();
    fireEvent.click(screen.getByTestId("calendar-event-context-confirm-delete"));

    await waitFor(() => {
      expect(mockDeleteCalendarEvent).toHaveBeenCalledTimes(1);
    });
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith("event-context-delete-outside", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-context-delete-outside"',
    }));
    expect(selectedChip.getAttribute("data-calendar-event-selection")).toBe("true");
  });

  it.each(["Delete", "Backspace"])("opens batch delete confirmation from %s without deleting immediately", async (key) => {
    const first = {
      id: `event-key-delete-first-${key}`,
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
      id: `event-key-delete-second-${key}`,
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
    fireEvent.keyDown(document, { key });

    expect(await screen.findByText("Delete 2 events?")).toBeTruthy();
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
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
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
  });
});
