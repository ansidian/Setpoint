import { describe, expect, it } from "vitest";
import { epochFromLa } from "../../../lib/dashboard-helpers";
import {
  buildConflictAgendaDays,
  selectConflictAgendaEntries,
} from "./calendarConflictAgendaModel";

function timedContext({
  id,
  startMs,
  endMs,
  conflicting = true,
}: {
  id: string;
  startMs: number;
  endMs: number;
  conflicting?: boolean;
}) {
  return {
    id,
    title: id,
    startMs,
    endMs,
    startDate: "",
    endDate: "",
    allDay: false,
    conflicting,
  };
}

describe("buildConflictAgendaDays", () => {
  it("splits an overnight proposal at Pacific midnight with continuation flags", () => {
    const startMs = epochFromLa(2026, 7, 30, 23, 0);
    const midnightMs = epochFromLa(2026, 7, 31, 0, 0);
    const endMs = epochFromLa(2026, 7, 31, 2, 0);
    const days = buildConflictAgendaDays({
      proposal: { startMs, endMs },
      scheduleContext: [],
    });

    expect(days.map((day) => ({
      date: day.date,
      start: day.proposal?.segmentStartMs,
      end: day.proposal?.segmentEndMs,
      continuesBefore: day.proposal?.continuesBefore,
      continuesAfter: day.proposal?.continuesAfter,
    }))).toEqual([
      {
        date: "2026-08-30",
        start: startMs,
        end: midnightMs,
        continuesBefore: false,
        continuesAfter: true,
      },
      {
        date: "2026-08-31",
        start: midnightMs,
        end: endMs,
        continuesBefore: true,
        continuesAfter: false,
      },
    ]);
  });

  it("does not create an empty final-day segment when an interval ends at midnight", () => {
    const days = buildConflictAgendaDays({
      proposal: {
        startMs: epochFromLa(2026, 7, 30, 22, 0),
        endMs: epochFromLa(2026, 7, 31, 0, 0),
      },
      scheduleContext: [],
    });

    expect(days.map((day) => day.date)).toEqual(["2026-08-30"]);
    expect(days[0]?.proposal?.continuesAfter).toBe(false);
  });

  it("attaches timed and all-day context to each affected Pacific date", () => {
    const days = buildConflictAgendaDays({
      proposal: {
        startMs: epochFromLa(2026, 7, 30, 23, 0),
        endMs: epochFromLa(2026, 8, 1, 2, 0),
      },
      scheduleContext: [
        timedContext({
          id: "overnight-work",
          startMs: epochFromLa(2026, 7, 31, 22, 0),
          endMs: epochFromLa(2026, 8, 1, 1, 0),
        }),
        {
          id: "retreat",
          title: "Retreat",
          startMs: epochFromLa(2026, 7, 30, 0, 0),
          endMs: epochFromLa(2026, 8, 2, 0, 0),
          startDate: "2026-08-30",
          endDate: "2026-09-01",
          allDay: true,
          conflicting: false,
        },
      ],
    });

    expect(days.map((day) => ({
      date: day.date,
      timed: day.timedContext.map((item) => item.sourceId),
      allDay: day.allDayContext.map((item) => item.sourceId),
    }))).toEqual([
      { date: "2026-08-30", timed: [], allDay: ["retreat"] },
      { date: "2026-08-31", timed: ["overnight-work"], allDay: ["retreat"] },
      { date: "2026-09-01", timed: ["overnight-work"], allDay: ["retreat"] },
    ]);
  });

  it("uses independently computed Pacific midnights across DST transitions", () => {
    const springDays = buildConflictAgendaDays({
      proposal: {
        startMs: epochFromLa(2026, 2, 8, 0, 0),
        endMs: epochFromLa(2026, 2, 9, 1, 0),
      },
      scheduleContext: [],
    });
    const fallDays = buildConflictAgendaDays({
      proposal: {
        startMs: epochFromLa(2026, 10, 1, 0, 0),
        endMs: epochFromLa(2026, 10, 2, 1, 0),
      },
      scheduleContext: [],
    });

    expect(springDays[0]!.nextDayStartMs - springDays[0]!.dayStartMs).toBe(23 * 60 * 60 * 1000);
    expect(fallDays[0]!.nextDayStartMs - fallDays[0]!.dayStartMs).toBe(25 * 60 * 60 * 1000);
  });
});

describe("selectConflictAgendaEntries", () => {
  it("keeps boundary and conflict days while summarizing each quiet gap", () => {
    const days = buildConflictAgendaDays({
      proposal: {
        startMs: epochFromLa(2026, 7, 1, 9, 0),
        endMs: epochFromLa(2026, 7, 7, 17, 0),
      },
      scheduleContext: [
        timedContext({
          id: "conflict-3",
          startMs: epochFromLa(2026, 7, 3, 10, 0),
          endMs: epochFromLa(2026, 7, 3, 11, 0),
        }),
        timedContext({
          id: "conflict-6",
          startMs: epochFromLa(2026, 7, 6, 10, 0),
          endMs: epochFromLa(2026, 7, 6, 11, 0),
        }),
      ],
    });

    expect(selectConflictAgendaEntries(days).map((entry) => (
      entry.kind === "day"
        ? { kind: entry.kind, date: entry.day.date }
        : { kind: entry.kind, count: entry.count }
    ))).toEqual([
      { kind: "day", date: "2026-08-01" },
      { kind: "omitted", count: 1 },
      { kind: "day", date: "2026-08-03" },
      { kind: "omitted", count: 2 },
      { kind: "day", date: "2026-08-06" },
      { kind: "day", date: "2026-08-07" },
    ]);
  });
});
