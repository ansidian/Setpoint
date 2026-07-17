import { describe, expect, it } from "vitest";
import {
  buildDeadlineGhostPreview,
  buildEventGhostPreview,
  dateOutsideVisibleGrid,
  ghostDisplayRange,
  ghostSpanDays,
} from "./ghostPreview.js";
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
}) {
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
}) {
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
    expect(batch.ghosts).toHaveLength(2);
    expect(batch.targetDate).toBe("2026-04-20");

    const recurring = buildEventGhostPreview({
      editor: {
        ...baseEditor,
        intentState: { mode: "recurring" },
        recurrenceDraft: { frequency: "weekly" },
      },
      events: [],
    });
    expect(recurring.ghosts).toHaveLength(1);
    expect(recurring.ghosts[0].recurring).toBe(true);
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
    expect(changed.ghosts).toHaveLength(1);
    expect(changed.ghosts[0]).toMatchObject({
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
      expect(preview.ghosts).toHaveLength(1);
      expect(preview.ghosts[0].conflictCount).toBe(1);
      expect(preview.ghosts[0].conflictTitles).toEqual(["Standup"]);
      expect(preview.totalConflictCount).toBe(1);
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
      expect(preview.ghosts[0].conflictCount).toBe(0);
      expect(preview.ghosts[0].conflictTitles).toEqual([]);
      expect(preview.totalConflictCount).toBe(0);
    });

    it("does not flag a same-account event on a different calendar", () => {
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
      expect(preview.ghosts[0].conflictCount).toBe(0);
      expect(preview.totalConflictCount).toBe(0);
    });

    it("does not flag a timed draft against an all-day event", () => {
      const preview = buildEventGhostPreview({
        editor: timedEditor,
        events: [allDayEvent({ title: "All-day holiday" })],
      });
      expect(preview.ghosts[0].conflictCount).toBe(0);
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
      expect(preview.ghosts[0].conflictCount).toBe(5);
      expect(preview.ghosts[0].conflictTitles).toEqual(["A", "B", "C"]);
      expect(preview.totalConflictCount).toBe(5);
    });
  });

  describe("all-day conflict detection", () => {
    it("flags an all-day draft overlapping an all-day event on the same day", () => {
      const preview = buildEventGhostPreview({
        editor: {
          ...timedEditor,
          draft: { ...timedEditor.draft, allDay: true },
        },
        events: [allDayEvent({ title: "Conference" })],
      });
      expect(preview.ghosts[0].allDay).toBe(true);
      expect(preview.ghosts[0].startTime).toBeNull();
      expect(preview.ghosts[0].endTime).toBeNull();
      expect(preview.ghosts[0].conflictCount).toBe(1);
      expect(preview.ghosts[0].conflictTitles).toEqual(["Conference"]);
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
      expect(preview.ghosts[0].conflictCount).toBe(1);
      expect(preview.ghosts[0].conflictTitles).toEqual(["Real conflict"]);
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

  describe("ghostDisplayRange formatting", () => {
    it("renders a deadline with its due time", () => {
      const ghost = { kind: "deadline", startDate: "2026-04-20", dueTime: "9:00 AM" };
      expect(ghostDisplayRange(ghost)).toBe("2026-04-20 · 9:00 AM");
    });

    it("falls back to End of day for a deadline with no time", () => {
      const ghost = { kind: "deadline", startDate: "2026-04-20" };
      expect(ghostDisplayRange(ghost)).toBe("2026-04-20 · End of day");
    });

    it("renders a single-day timed range as a 12-hour window", () => {
      const ghost = {
        kind: "event",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "09:00",
        endTime: "17:30",
      };
      expect(ghostDisplayRange(ghost)).toBe("2026-04-20 · 9:00 AM-5:30 PM");
    });

    it("renders a single-day all-day ghost", () => {
      const ghost = {
        kind: "event",
        allDay: true,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
      };
      expect(ghostDisplayRange(ghost)).toBe("2026-04-20 · All day");
    });

    it("renders a multi-day all-day span", () => {
      const ghost = {
        kind: "event",
        allDay: true,
        startDate: "2026-04-20",
        endDate: "2026-04-22",
      };
      expect(ghostDisplayRange(ghost)).toBe("2026-04-20 to 2026-04-22 · All day");
    });

    it("returns an empty string for no ghost", () => {
      expect(ghostDisplayRange(null)).toBe("");
    });
  });

  describe("ghostSpanDays", () => {
    it("counts the day delta across an inclusive range", () => {
      expect(ghostSpanDays({ startDate: "2026-04-20", endDate: "2026-04-23" })).toBe(3);
    });

    it("is zero for a single day", () => {
      expect(ghostSpanDays({ startDate: "2026-04-20", endDate: "2026-04-20" })).toBe(0);
    });

    it("never goes negative when endDate precedes startDate", () => {
      expect(ghostSpanDays({ startDate: "2026-04-23", endDate: "2026-04-20" })).toBe(0);
    });

    it("is zero when dates are missing", () => {
      expect(ghostSpanDays({ startDate: "2026-04-20" })).toBe(0);
      expect(ghostSpanDays(null)).toBe(0);
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
