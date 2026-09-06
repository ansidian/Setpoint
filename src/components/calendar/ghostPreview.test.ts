import { describe, expect, it } from "vitest";
import {
  buildDeadlineGhostPreview,
  buildEventGhostPreview,
  dateOutsideVisibleGrid
} from "./ghostPreview.ts";
import type { CalendarEventLike } from "./ghostPreview.ts";
import { epochFromLa } from "../../lib/dashboard-helpers";

// Build a calendar event fixture whose Pacific epoch bounds line up with the
// ghostPreview conflict math (which derives ghost epochs via the same
// epochFromLa helper). Month is 0-indexed to match JS Date / laComponents.
function timedEvent({
  title,
  date = [2026, 3, 20],
  start = [9, 0],
  end = [9, 30],
  accountId = "gmail-main",
  calendarId = "primary",
}: { title: string; date?: [number, number, number]; start?: [number, number]; end?: [number, number]; accountId?: string; calendarId?: string }): CalendarEventLike {
  const [y, m, d] = date;
  return {
    id: `evt-${title}`,
    title,
    accountId,
    calendarId,
    allDay: false,
    startMs: epochFromLa(y, m, d, start[0], start[1]),
    endMs: epochFromLa(y, m, d, end[0], end[1]),
  };
}

// All-day events store an exclusive end (start-of-next-day), matching how the
// real calendar persists them; the source subtracts a day to get the inclusive
// last date.
function allDayEvent({
  title,
  startDate = [2026, 3, 20],
  endDateExclusive = [2026, 3, 21],
  accountId = "gmail-main",
  calendarId = "primary",
}: { title: string; startDate?: [number, number, number]; endDateExclusive?: [number, number, number]; accountId?: string; calendarId?: string }): CalendarEventLike {
  return {
    id: `evt-${title}`,
    title,
    accountId,
    calendarId,
    allDay: true,
    startMs: epochFromLa(startDate[0], startDate[1], startDate[2], 0, 0),
    endMs: epochFromLa(endDateExclusive[0], endDateExclusive[1], endDateExclusive[2], 0, 0),
  };
}

const timedEditor = {
  isEditorOpen: true,
  draft: {
    accountId: "gmail-main",
    calendarId: "primary",
    allDay: false,
    startDate: "2026-04-20",
    endDate: "2026-04-20",
    startTime: "09:00",
    endTime: "09:30",
  },
  effectiveTitle: "Work",
  writableCalendars: [{ value: "gmail-main::primary", color: "#4285f4" }],
};

describe("calendar ghost previews", () => {
  it("previews finite batch event drafts and only the first recurring occurrence", () => {
    const baseEditor = {
      isEditorOpen: true,
      draft: {
        accountId: "gmail-main",
        calendarId: "primary",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "09:00",
        endTime: "09:30",
      },
      effectiveTitle: "Work",
      writableCalendars: [{ value: "gmail-main::primary", color: "#4285f4" }],
    };

    const batch = buildEventGhostPreview({
      editor: {
        ...baseEditor,
        intentState: { mode: "batch" },
        batchDrafts: [
          { title: "Work", startDate: "2026-04-20", endDate: "2026-04-20", startTime: "09:00", endTime: "09:30" },
          { title: "Work", startDate: "2026-04-21", endDate: "2026-04-21", startTime: "09:00", endTime: "09:30" },
        ],
      },
      events: [],
    });
    expect(batch!.ghosts).toHaveLength(2);
    expect(batch!.targetDate).toBe("2026-04-20");

    const recurring = buildEventGhostPreview({
      editor: {
        ...baseEditor,
        intentState: { mode: "recurring" },
        recurrenceDraft: { frequency: "weekly" },
      },
      events: [],
    });
    expect(recurring!.ghosts).toHaveLength(1);
    expect(recurring!.ghosts[0]!.recurring).toBe(true);
  });

  it("keeps deadline ghosts single-day and suppresses unchanged edits", () => {
    const unchanged = buildDeadlineGhostPreview({
      draft: {
        title: "Ship report",
        dueDate: "2026-04-20",
        dueTime: "9:00 AM",
        isEditing: true,
        placementChanged: false,
      },
      dateItems: { activeCount: 2 },
    });
    expect(unchanged).toBeNull();

    const changed = buildDeadlineGhostPreview({
      draft: {
        title: "Ship report",
        dueDate: "2026-04-21",
        dueTime: "9:00 AM",
        priority: 1,
        isEditing: true,
        placementChanged: true,
      },
      dateItems: { activeCount: 3 },
    });
    expect(changed!.ghosts).toHaveLength(1);
    expect(changed!.ghosts[0]).toMatchObject({
      kind: "deadline",
      startDate: "2026-04-21",
      endDate: "2026-04-21",
      color: "#e44332",
      dueMinutes: 540,
      crowdedCount: 3,
    });
  });

  describe("timed-event conflict detection", () => {
    it("flags a timed overlap with its count and titles", () => {
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [
          timedEvent({ title: "Standup", start: [9, 15], end: [10, 0] }),
        ],
      });
      expect(preview!.ghosts).toHaveLength(1);
      expect(preview!.ghosts[0]!.conflictCount).toBe(1);
      expect(preview!.ghosts[0]!.conflictTitles).toEqual(["Standup"]);
      expect(preview!.totalConflictCount).toBe(1);
    });

    it("does not flag a back-to-back event that only touches the boundary", () => {
      // Draft ends 09:30; this event starts exactly 09:30 — half-open overlap
      // (start < end && end > start) means a shared edge is not a conflict.
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [
          timedEvent({ title: "Adjacent", start: [9, 30], end: [10, 0] }),
        ],
      });
      expect(preview!.ghosts[0]!.conflictCount).toBe(0);
      expect(preview!.ghosts[0]!.conflictTitles).toEqual([]);
      expect(preview!.totalConflictCount).toBe(0);
    });

    it("flags a visible overlap from a different calendar and preserves its details", () => {
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [
          timedEvent({
            title: "Other calendar",
            start: [9, 15],
            end: [10, 0],
            accountId: "gmail-main",
            calendarId: "work",
          }),
        ],
      });
      expect(preview!.ghosts[0]!.conflictCount).toBe(1);
      expect(preview!.ghosts[0]!.conflicts).toEqual([
        expect.objectContaining({
          id: "evt-Other calendar",
          title: "Other calendar",
          allDay: false,
        }),
      ]);
      expect(preview!.ghosts[0]!.scheduleContext).toEqual([
        expect.objectContaining({ title: "Other calendar", conflicting: true }),
      ]);
      expect(preview!.totalConflictCount).toBe(1);
    });

    it("frames conflicts with the nearest timed event before and after", () => {
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [
          timedEvent({ title: "Too early", start: [7, 0], end: [7, 30] }),
          timedEvent({ title: "Before", start: [8, 0], end: [8, 30] }),
          timedEvent({ title: "Conflict", start: [9, 15], end: [10, 0] }),
          timedEvent({ title: "After", start: [10, 15], end: [11, 0] }),
          timedEvent({ title: "Too late", start: [12, 0], end: [13, 0] }),
          allDayEvent({ title: "All day" }),
        ],
      });

      expect(preview!.ghosts[0]!.scheduleContext?.map((event) => ({
        title: event.title,
        conflicting: event.conflicting,
      }))).toEqual([
        { title: "All day", conflicting: false },
        { title: "Before", conflicting: false },
        { title: "Conflict", conflicting: true },
        { title: "After", conflicting: false },
      ]);
    });

    it("keeps surrounding schedule context when the draft does not overlap", () => {
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [
          timedEvent({ title: "Before", start: [8, 0], end: [8, 30] }),
          timedEvent({ title: "After", start: [10, 15], end: [11, 0] }),
        ],
      });

      expect(preview!.totalConflictCount).toBe(0);
      expect(preview!.ghosts[0]!.scheduleContext?.map((event) => event.title)).toEqual(["Before", "After"]);
    });

    it("omits non-overlapping neighbors more than 90 minutes from the draft", () => {
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [
          timedEvent({ title: "Far before", start: [6, 0], end: [7, 0] }),
          timedEvent({ title: "Far after", start: [11, 1], end: [12, 0] }),
        ],
      });

      expect(preview!.totalConflictCount).toBe(0);
      expect(preview!.ghosts[0]!.scheduleContext).toEqual([]);
    });

    it("keeps an all-day event as context without flagging a timed conflict", () => {
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [allDayEvent({ title: "All-day holiday" })],
      });
      expect(preview!.ghosts[0]!.conflictCount).toBe(0);
      expect(preview!.ghosts[0]!.scheduleContext).toEqual([
        expect.objectContaining({
          title: "All-day holiday",
          allDay: true,
          startDate: "2026-04-20",
          endDate: "2026-04-20",
          conflicting: false,
        }),
      ]);
    });

    it("includes timed conflicts from later dates in a multi-day proposal", () => {
      const preview = buildEventGhostPreview({
        editor: {
          ...timedEditor,
          draft: {
            ...timedEditor.draft,
            endDate: "2026-04-21",
            endTime: "10:00",
          },
        },
        events: [
          timedEvent({ title: "Second-day conflict", date: [2026, 3, 21], start: [9, 15], end: [9, 45] }),
        ],
      });

      expect(preview!.ghosts[0]!.conflictCount).toBe(1);
      expect(preview!.ghosts[0]!.scheduleContext).toEqual([
        expect.objectContaining({ title: "Second-day conflict", conflicting: true }),
      ]);
    });

    it("caps conflict titles at three while counting every overlap", () => {
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [
          timedEvent({ title: "A", start: [9, 5], end: [9, 25] }),
          timedEvent({ title: "B", start: [9, 10], end: [9, 28] }),
          timedEvent({ title: "C", start: [9, 12], end: [9, 29] }),
          timedEvent({ title: "D", start: [9, 14], end: [9, 26] }),
          timedEvent({ title: "E", start: [9, 16], end: [9, 27] }),
        ],
      });
      expect(preview!.ghosts[0]!.conflictCount).toBe(5);
      expect(preview!.ghosts[0]!.conflictTitles).toEqual(["A", "B", "C"]);
      expect(preview!.ghosts[0]!.conflicts?.map((conflict) => conflict.title)).toEqual(["A", "B", "C", "D", "E"]);
      expect(preview!.totalConflictCount).toBe(5);
    });
  });

  describe("all-day schedule context", () => {
    it("shows all-day and timed commitments without treating them as hard conflicts", () => {
      const preview = buildEventGhostPreview({
        editor: {
          ...timedEditor,
          draft: { ...timedEditor.draft, allDay: true },
        },
        events: [
          allDayEvent({ title: "Conference" }),
          timedEvent({ title: "Standup", start: [9, 0], end: [9, 30] }),
        ],
      });
      expect(preview!.ghosts[0]!.allDay).toBe(true);
      expect(preview!.ghosts[0]!.startTime).toBeNull();
      expect(preview!.ghosts[0]!.endTime).toBeNull();
      expect(preview!.ghosts[0]!.conflictCount).toBe(0);
      expect(preview!.ghosts[0]!.conflictTitles).toEqual([]);
      expect(preview!.ghosts[0]!.scheduleContext).toEqual([
        expect.objectContaining({
          title: "Conference",
          allDay: true,
          startDate: "2026-04-20",
          endDate: "2026-04-20",
          conflicting: false,
        }),
        expect.objectContaining({ title: "Standup", allDay: false, conflicting: false }),
      ]);
    });

    it("preserves the inclusive range of a multi-day all-day context item", () => {
      const preview = buildEventGhostPreview({
        editor: {
          ...timedEditor,
          draft: { ...timedEditor.draft, allDay: true, endDate: "2026-04-22" },
        },
        events: [
          allDayEvent({
            title: "Retreat",
            startDate: [2026, 3, 20],
            endDateExclusive: [2026, 3, 23],
          }),
        ],
      });

      expect(preview!.ghosts[0]!.scheduleContext).toEqual([
        expect.objectContaining({
          title: "Retreat",
          startDate: "2026-04-20",
          endDate: "2026-04-22",
        }),
      ]);
    });
  });

  describe("editing-event self skip", () => {
    it("does not count the dragged event as its own conflict", () => {
      // The event being edited shares id + originalStartTime with the entry in
      // `events`, so sameEventIdentity skips it; an unrelated overlap still counts.
      const editingEvent = {
        id: "evt-self",
        isRecurring: false,
        originalStartTime: "2026-04-20T08:00:00",
      };
      const selfEvent = timedEvent({ title: "Self", start: [9, 0], end: [9, 30] });
      selfEvent.id = "evt-self";
      selfEvent.originalStartTime = "2026-04-20T08:00:00";

      const preview = buildEventGhostPreview({
        editor: {
          ...timedEditor,
          editingEvent,
          // Move it so originalKey !== nextKey and the preview is not suppressed.
          draft: { ...timedEditor.draft, startTime: "09:05", endTime: "09:35" },
        },
        events: [
          selfEvent,
          timedEvent({ title: "Real conflict", start: [9, 10], end: [9, 40] }),
        ],
      });
      expect(preview!.ghosts[0]!.conflictCount).toBe(1);
      expect(preview!.ghosts[0]!.conflictTitles).toEqual(["Real conflict"]);
    });
  });

  describe("event preview validity boundaries", () => {
    it("returns null when an edited event is not actually moved", () => {
      const editingEvent = {
        id: "evt-keep",
        accountId: "gmail-main",
        calendarId: "primary",
        allDay: false,
        // 2026-04-20 09:00-09:30 Pacific — identical placement to the draft.
        startMs: epochFromLa(2026, 3, 20, 9, 0),
        endMs: epochFromLa(2026, 3, 20, 9, 30),
      };
      const preview = buildEventGhostPreview({
        editor: { ...timedEditor, editingEvent },
        events: [],
      });
      expect(preview).toBeNull();
    });

    it("returns null when endDate precedes startDate", () => {
      const preview = buildEventGhostPreview({
        editor: {
          ...timedEditor,
          draft: { ...timedEditor.draft, startDate: "2026-04-21", endDate: "2026-04-20" },
        },
        events: [],
      });
      expect(preview).toBeNull();
    });

    it("returns null for a malformed start date", () => {
      const preview = buildEventGhostPreview({
        editor: {
          ...timedEditor,
          draft: { ...timedEditor.draft, startDate: "2026-13-40", endDate: "2026-13-40" },
        },
        events: [],
      });
      expect(preview).toBeNull();
    });

    it("returns null for a malformed dueDate deadline draft", () => {
      const preview = buildDeadlineGhostPreview({
        draft: { title: "Bad", dueDate: "2026-13-40", placementChanged: true },
        dateItems: { activeCount: 1 },
      });
      expect(preview).toBeNull();
    });
  });

  describe("dateOutsideVisibleGrid", () => {
    // April 2026: starts Wed (firstDay 3), 30 days -> 5 rows.
    // Visible grid runs Sun Mar 29 2026 through Sat May 2 2026.
    it("treats in-month dates as inside the grid", () => {
      expect(dateOutsideVisibleGrid("2026-04-20", 2026, 3)).toBe(false);
    });

    it("includes the leading days from the previous month", () => {
      // Mar 29 is the first visible cell; Mar 28 spills past the top edge.
      expect(dateOutsideVisibleGrid("2026-03-29", 2026, 3)).toBe(false);
      expect(dateOutsideVisibleGrid("2026-03-28", 2026, 3)).toBe(true);
    });

    it("includes the trailing days from the next month up to the last row", () => {
      // May 2 is the last visible cell; May 3 falls past the bottom edge.
      expect(dateOutsideVisibleGrid("2026-05-02", 2026, 3)).toBe(false);
      expect(dateOutsideVisibleGrid("2026-05-03", 2026, 3)).toBe(true);
    });

    it("uses six rows for a month that overflows the grid", () => {
      // August 2026: starts Sat (firstDay 6), 31 days -> 6 rows.
      // Visible grid runs Sun Jul 26 2026 through Sat Sep 5 2026.
      expect(dateOutsideVisibleGrid("2026-07-26", 2026, 7)).toBe(false);
      expect(dateOutsideVisibleGrid("2026-07-25", 2026, 7)).toBe(true);
      expect(dateOutsideVisibleGrid("2026-09-05", 2026, 7)).toBe(false);
      expect(dateOutsideVisibleGrid("2026-09-06", 2026, 7)).toBe(true);
    });

    it("returns false for an unparseable date key", () => {
      expect(dateOutsideVisibleGrid("not-a-date", 2026, 3)).toBe(false);
    });
  });
});
