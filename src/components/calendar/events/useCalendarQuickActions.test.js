import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api", () => ({
  createCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

const { createCalendarEvent, deleteCalendarEvent } = await import("@/api");
const {
  default: useCalendarQuickActions,
  buildCloneEventPayload,
  buildColorUpdatePayload,
  buildOptimisticCloneEvent,
  buildReschedulePayload,
} = await import("./useCalendarQuickActions");

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCalendarQuickActions helpers", () => {
  it("builds drag-drop reschedule payloads from the shifted event date and original time", () => {
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
      location: "Office",
      description: "Notes",
    };
    const shiftedEvent = {
      ...event,
      startMs: new Date("2026-04-21T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-21T17:30:00.000Z").getTime(),
    };

    expect(buildReschedulePayload(event, shiftedEvent)).toEqual({
      accountId: "gmail-main",
      calendarId: "primary",
      title: "Move me",
      allDay: false,
      startDate: "2026-04-21",
      endDate: "2026-04-21",
      startTime: "09:00",
      endTime: "10:30",
      location: "Office",
      description: "Notes",
      etag: '"etag-drag-1"',
      scope: undefined,
      recurringEventId: undefined,
      originalStartTime: undefined,
    });
  });

  it("builds standalone clone payloads on the target date without recurrence metadata", () => {
    const event = {
      id: "event-copy-1",
      etag: '"etag-copy-1"',
      title: "Copy me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      location: "Office",
      description: "Notes",
      colorId: "7",
    };

    expect(buildCloneEventPayload(event, "2026-04-22")).toEqual({
      accountId: "gmail-main",
      calendarId: "primary",
      title: "Copy me",
      allDay: false,
      startDate: "2026-04-22",
      endDate: "2026-04-22",
      startTime: "09:00",
      endTime: "10:30",
      location: "Office",
      description: "Notes",
      colorId: "7",
    });
  });

  it("uses mapped source color ids when cloning events without explicit overrides", () => {
    const event = {
      id: "event-copy-source-color",
      title: "Copy source color",
      accountId: "gmail-main",
      calendarId: "work",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
      allDay: false,
      colorId: null,
      sourceColorId: "3",
    };

    expect(buildCloneEventPayload(event, "2026-04-22")).toMatchObject({
      colorId: "3",
    });
  });

  it("preserves all-day spans when cloning onto a target date", () => {
    const event = {
      id: "event-copy-all-day",
      title: "Trip",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T19:00:00.000Z").getTime(),
      endMs: new Date("2026-04-23T19:00:00.000Z").getTime(),
      allDay: true,
    };

    expect(buildCloneEventPayload(event, "2026-05-01")).toMatchObject({
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      startTime: null,
      endTime: null,
    });
  });

  it("builds optimistic standalone clone events on the target date", () => {
    const event = {
      id: "event-copy-optimistic",
      title: "Copy optimistic",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
      colorId: "7",
    };

    expect(buildOptimisticCloneEvent(event, "2026-04-22")).toMatchObject({
      id: expect.stringMatching(/^optimistic-calendar-copy-event-copy-optimistic-/),
      title: "Copy optimistic",
      startMs: new Date("2026-04-22T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-22T17:30:00.000Z").getTime(),
      colorId: "7",
      color: "#46d6db",
      isRecurring: false,
      recurringEventId: null,
      originalStartTime: null,
      passed: false,
    });
  });

  it("builds scoped color payloads for recurring events", () => {
    const event = {
      id: "event-color-1",
      etag: '"etag-color-1"',
      title: "Color me",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:30:00.000Z").getTime(),
      allDay: false,
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    };

    expect(buildColorUpdatePayload(event, "11", "following")).toMatchObject({
      accountId: "gmail-main",
      calendarId: "primary",
      colorId: "11",
      scope: "following",
      recurringEventId: "series-1",
      originalStartTime: "2026-04-20T16:00:00.000Z",
    });
  });
});

describe("useCalendarQuickActions clone races", () => {
  it("treats deleting a pending optimistic clone as cancellation until the provider create reconciles", async () => {
    let resolveCreate;
    createCalendarEvent.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
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
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const onSelectEvent = vi.fn();
    const onEventDeleted = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onSelectEvent,
      onEventDeleted,
    }));

    act(() => {
      result.current.pasteEvent(sourceEvent, "2026-04-22");
    });

    const optimisticEvent = upsertEvents.mock.calls[0][0];
    expect(optimisticEvent.id).toMatch(/^optimistic-calendar-copy-event-copy-race-/);

    await act(async () => {
      result.current.openContextMenu({ event: optimisticEvent, x: 80, y: 80 });
    });
    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    expect(deleteCalendarEvent).not.toHaveBeenCalledWith(optimisticEvent.id, expect.anything());
    expect(removeEvent).toHaveBeenCalledWith(optimisticEvent.id);

    await act(async () => {
      resolveCreate({
        event: {
          ...optimisticEvent,
          id: "google-created-copy",
          etag: '"etag-created-copy"',
        },
      });
    });

    expect(upsertEvents).not.toHaveBeenCalledWith(expect.objectContaining({ id: "google-created-copy" }));
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-copy", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-created-copy"',
    }));
    expect(onEventDeleted).toHaveBeenCalledWith(optimisticEvent.id, optimisticEvent);
  });

  it("deletes the reconciled event when a temp clone menu confirms after create resolves", async () => {
    createCalendarEvent.mockResolvedValue({
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
    const upsertEvents = vi.fn();
    const removeEvent = vi.fn();
    const onEventDeleted = vi.fn();
    const { result } = renderHook(() => useCalendarQuickActions({
      editable: true,
      upsertEvents,
      removeEvent,
      onEventDeleted,
    }));

    act(() => {
      result.current.pasteEvent(sourceEvent, "2026-04-22");
    });

    const optimisticEvent = upsertEvents.mock.calls[0][0];
    await act(async () => {
      result.current.openContextMenu({ event: optimisticEvent, x: 80, y: 80 });
    });
    await act(async () => {});

    act(() => {
      result.current.requestDelete();
    });
    await act(async () => {
      await result.current.confirmContextDelete();
    });

    expect(removeEvent).toHaveBeenCalledWith("google-created-copy-late-delete");
    expect(deleteCalendarEvent).toHaveBeenCalledWith("google-created-copy-late-delete", expect.objectContaining({
      accountId: "gmail-main",
      calendarId: "primary",
      etag: '"etag-late-delete"',
    }));
    expect(onEventDeleted).toHaveBeenCalledWith("google-created-copy-late-delete", expect.objectContaining({
      id: "google-created-copy-late-delete",
    }));
  });
});
