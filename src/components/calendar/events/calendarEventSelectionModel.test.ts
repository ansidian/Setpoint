import { describe, expect, it } from "vitest";
import {
  calendarEventSelectionIdentity,
  createCalendarEventSelectionSet,
  createCalendarEventClipboard,
  getOrderedCalendarEventSelection,
  isCalendarEventSelected,
  isCalendarEventSelectionEligible,
  isEventSelectionModifier,
  planCalendarEventClipboardPaste,
  removeCalendarEventSelection,
  resolveCalendarEventActionScope,
  clearCalendarEventSelection,
  calendarEventSelectionSize,
  toggleCalendarEventSelection,
} from "./calendarEventSelectionModel";

const ms = (iso: string) => new Date(iso).getTime();

function googleEvent(overrides = {}) {
  return {
    id: "event-1",
    title: "Standup",
    accountId: "gmail-main",
    calendarId: "primary",
    startMs: ms("2026-05-18T16:00:00.000Z"),
    endMs: ms("2026-05-18T16:30:00.000Z"),
    allDay: false,
    writable: true,
    ...overrides,
  };
}

describe("calendarEventSelectionModel", () => {
  it("admits writable Google events and toggles recurring occurrences by occurrence identity", () => {
    const firstOccurrence = googleEvent({
      id: "series-1_20260518T160000Z",
      title: "Recurring standup",
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-05-18T16:00:00.000Z",
    });
    const secondOccurrence = googleEvent({
      id: "series-1_20260519T160000Z",
      title: "Recurring standup",
      startMs: ms("2026-05-19T16:00:00.000Z"),
      endMs: ms("2026-05-19T16:30:00.000Z"),
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-05-19T16:00:00.000Z",
    });

    expect(isCalendarEventSelectionEligible(firstOccurrence)).toBe(true);
    expect(calendarEventSelectionIdentity(firstOccurrence))
      .toBe("gmail-main::primary::series-1::2026-05-18T16:00:00.000Z");
    expect(calendarEventSelectionIdentity(secondOccurrence))
      .toBe("gmail-main::primary::series-1::2026-05-19T16:00:00.000Z");

    let selection = createCalendarEventSelectionSet();
    selection = toggleCalendarEventSelection(selection, firstOccurrence);
    selection = toggleCalendarEventSelection(selection, secondOccurrence);

    expect(isCalendarEventSelected(selection, firstOccurrence)).toBe(true);
    expect(isCalendarEventSelected(selection, secondOccurrence)).toBe(true);
    expect(getOrderedCalendarEventSelection(selection).map((event) => event.id))
      .toEqual(["series-1_20260518T160000Z", "series-1_20260519T160000Z"]);

    selection = toggleCalendarEventSelection(selection, firstOccurrence);

    expect(isCalendarEventSelected(selection, firstOccurrence)).toBe(false);
    expect(isCalendarEventSelected(selection, secondOccurrence)).toBe(true);
    expect(getOrderedCalendarEventSelection(selection).map((event) => event.id))
      .toEqual(["series-1_20260519T160000Z"]);
  });

  it("excludes non-event rows and resolves multi-day non-recurring segments to one identity", () => {
    const base = googleEvent();

    expect(isCalendarEventSelectionEligible({ ...base, writable: false })).toBe(false);
    expect(isCalendarEventSelectionEligible({
      ...base,
      id: "deadline-1",
      source: "todoist",
      agendaItemKind: "deadline",
    })).toBe(false);
    expect(isCalendarEventSelectionEligible({
      ...base,
      id: "bill-1",
      kind: "bill",
      billId: "internet",
    })).toBe(false);
    expect(isCalendarEventSelectionEligible({
      ...base,
      id: "ghost-1",
      ghostKind: "event",
      startDate: "2026-05-18",
    })).toBe(false);
    expect(isCalendarEventSelectionEligible({
      ...base,
      id: "search-row-1",
      resultKind: "calendar-search-result",
      payload: base,
    })).toBe(false);
    expect(isCalendarEventSelectionEligible({
      ...base,
      id: "birthday-1",
      title: "Maya's birthday",
      eventType: "birthday",
      birthdayProperties: { type: "birthday" },
      allDay: true,
      writable: true,
    })).toBe(false);
    expect(isCalendarEventSelectionEligible({
      ...base,
      id: "birthday-source-1",
      title: "Rin's birthday",
      sourceLabel: "Birthdays",
      allDay: true,
      writable: true,
    })).toBe(false);

    const trip = googleEvent({
      id: "trip-1",
      title: "Trip",
      allDay: true,
      startMs: ms("2026-05-18T07:00:00.000Z"),
      endMs: ms("2026-05-21T07:00:00.000Z"),
      agendaDateKey: "2026-05-18",
    });
    const secondVisualSegment = {
      ...trip,
      agendaDateKey: "2026-05-19",
    };

    expect(calendarEventSelectionIdentity(secondVisualSegment))
      .toBe(calendarEventSelectionIdentity(trip));
    expect(getOrderedCalendarEventSelection(
      createCalendarEventSelectionSet([trip, secondVisualSegment]),
    ).map((event) => event.id)).toEqual(["trip-1"]);
  });

  it("orders selected events deterministically and scopes context actions by membership", () => {
    const early = googleEvent({
      id: "event-early",
      title: "Zoo",
      startMs: ms("2026-05-18T15:00:00.000Z"),
      endMs: ms("2026-05-18T15:30:00.000Z"),
    });
    const sameTimeAlpha = googleEvent({
      id: "event-alpha",
      title: "Alpha",
      startMs: ms("2026-05-18T16:00:00.000Z"),
      endMs: ms("2026-05-18T16:30:00.000Z"),
    });
    const sameTimeBeta = googleEvent({
      id: "event-beta",
      title: "Beta",
      startMs: ms("2026-05-18T16:00:00.000Z"),
      endMs: ms("2026-05-18T16:30:00.000Z"),
    });
    const outside = googleEvent({ id: "event-outside", title: "Outside" });

    const selection = [sameTimeBeta, early, sameTimeAlpha].reduce(
      (current, event) => toggleCalendarEventSelection(current, event),
      createCalendarEventSelectionSet(),
    );

    expect(getOrderedCalendarEventSelection(selection).map((event) => event.id))
      .toEqual(["event-early", "event-alpha", "event-beta"]);

    expect(resolveCalendarEventActionScope(selection, sameTimeBeta)).toMatchObject({
      kind: "selection",
      events: [
        { id: "event-early" },
        { id: "event-alpha" },
        { id: "event-beta" },
      ],
    });
    expect(resolveCalendarEventActionScope(selection, outside)).toMatchObject({
      kind: "single",
      events: [{ id: "event-outside" }],
    });
    expect(resolveCalendarEventActionScope(selection, { ...outside, writable: false }))
      .toEqual({ kind: "none", events: [], identities: [] });
  });

  it("removes and clears selection members without toggling unrelated events", () => {
    const first = googleEvent({ id: "event-first", title: "First" });
    const second = googleEvent({ id: "event-second", title: "Second" });
    const third = googleEvent({ id: "event-third", title: "Third" });
    const selection = createCalendarEventSelectionSet([first, second]);

    const afterMissingRemove = removeCalendarEventSelection(selection, third);
    expect(calendarEventSelectionSize(afterMissingRemove)).toBe(2);
    expect(isCalendarEventSelected(afterMissingRemove, first)).toBe(true);
    expect(isCalendarEventSelected(afterMissingRemove, second)).toBe(true);

    const afterRemove = removeCalendarEventSelection(afterMissingRemove, first);
    expect(calendarEventSelectionSize(afterRemove)).toBe(1);
    expect(isCalendarEventSelected(afterRemove, first)).toBe(false);
    expect(isCalendarEventSelected(afterRemove, second)).toBe(true);

    expect(clearCalendarEventSelection()).toEqual({ items: [] });
  });

  it("creates internal clipboards and plans standalone paste payloads with relative offsets", () => {
    const recurringStandup = googleEvent({
      id: "series-1_20260518T160000Z",
      title: "Recurring standup",
      startMs: ms("2026-05-18T16:00:00.000Z"),
      endMs: ms("2026-05-18T17:00:00.000Z"),
      isRecurring: true,
      recurringEventId: "series-1",
      originalStartTime: "2026-05-18T16:00:00.000Z",
      recurrence: { frequency: "weekly" },
      sourceColorId: "3",
      location: "Office",
    });
    const trip = googleEvent({
      id: "trip-1",
      title: "Trip",
      allDay: true,
      startMs: ms("2026-05-20T07:00:00.000Z"),
      endMs: ms("2026-05-23T07:00:00.000Z"),
      colorId: "7",
      location: "LAX",
      description: "Boarding pass",
    });
    const selection = [trip, recurringStandup].reduce(
      (current, event) => toggleCalendarEventSelection(current, event),
      createCalendarEventSelectionSet(),
    );

    const clipboard = createCalendarEventClipboard(selection);

    expect(createCalendarEventClipboard(recurringStandup)?.events).toHaveLength(1);
    expect(clipboard).toMatchObject({
      kind: "calendar-event-clipboard",
      version: 1,
      events: [
        { title: "Recurring standup", sourceIdentity: calendarEventSelectionIdentity(recurringStandup) },
        { title: "Trip", sourceIdentity: calendarEventSelectionIdentity(trip) },
      ],
    });

    expect(planCalendarEventClipboardPaste(clipboard, "2026-06-01")).toEqual({
      kind: "calendar-event-paste-plan",
      anchorDate: "2026-05-18",
      targetDate: "2026-06-01",
      items: [
        {
          accountId: "gmail-main",
          calendarId: "primary",
          title: "Recurring standup",
          allDay: false,
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          startTime: "09:00",
          endTime: "10:00",
          location: "Office",
          description: "",
          colorId: "3",
        },
        {
          accountId: "gmail-main",
          calendarId: "primary",
          title: "Trip",
          allDay: true,
          startDate: "2026-06-03",
          endDate: "2026-06-05",
          startTime: null,
          endTime: null,
          location: "LAX",
          description: "Boarding pass",
          colorId: "7",
        },
      ],
    });
  });

  describe("isEventSelectionModifier", () => {
    it("returns true when metaKey, ctrlKey, or both are set", () => {
      expect(isEventSelectionModifier({ metaKey: true })).toBe(true);
      expect(isEventSelectionModifier({ ctrlKey: true })).toBe(true);
      expect(isEventSelectionModifier({ metaKey: true, ctrlKey: true })).toBe(true);
    });

    it("returns false for missing, empty, or non-modifier events", () => {
      expect(isEventSelectionModifier({})).toBe(false);
      expect(isEventSelectionModifier({ shiftKey: true })).toBe(false);
      expect(isEventSelectionModifier(null)).toBe(false);
      expect(isEventSelectionModifier(undefined)).toBe(false);
    });
  });
});
