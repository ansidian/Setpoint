import { epochFromLa } from "../../../lib/dashboard-helpers";
import { addDaysYmd, pacificYMD, parseYmd } from "../calendarDateUtils";
import type { CalendarScheduleContextItem } from "../ghostPreview";

export interface ConflictAgendaProposal {
  startMs: number;
  endMs: number;
}

export interface ConflictAgendaTimedSegment {
  segmentId: string;
  sourceId: string;
  sourceStartMs: number;
  date: string;
  segmentStartMs: number;
  segmentEndMs: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  conflicting: boolean;
}

export interface ConflictAgendaAllDayItem {
  sourceId: string;
  sourceStartMs: number;
  date: string;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface ConflictAgendaDay {
  date: string;
  dayStartMs: number;
  nextDayStartMs: number;
  proposal: ConflictAgendaTimedSegment;
  timedContext: ConflictAgendaTimedSegment[];
  allDayContext: ConflictAgendaAllDayItem[];
  hasConflict: boolean;
}

export type ConflictAgendaEntry =
  | { kind: "day"; day: ConflictAgendaDay; reasons: Array<"first" | "conflict" | "final"> }
  | { kind: "omitted"; startDate: string; endDate: string; count: number };

function midnightEpoch(date: string) {
  const parsed = parseYmd(date);
  if (!parsed) return null;
  return epochFromLa(parsed.year, parsed.month, parsed.day, 0, 0);
}

function proposalDates(proposal: ConflictAgendaProposal) {
  const firstDate = pacificYMD(proposal.startMs);
  const finalInstant = proposal.endMs > proposal.startMs ? proposal.endMs - 1 : proposal.endMs;
  const finalDate = pacificYMD(finalInstant);
  const dates: string[] = [];
  for (let date = firstDate; date <= finalDate; date = addDaysYmd(date, 1)) dates.push(date);
  return dates;
}

function timedSegment(
  sourceId: string,
  startMs: number,
  endMs: number,
  date: string,
  dayStartMs: number,
  nextDayStartMs: number,
  conflicting: boolean,
) {
  const segmentStartMs = Math.max(startMs, dayStartMs);
  const segmentEndMs = Math.min(endMs, nextDayStartMs);
  if (segmentStartMs >= segmentEndMs) return null;
  return {
    segmentId: `${sourceId}-${startMs}-${date}`,
    sourceId,
    sourceStartMs: startMs,
    date,
    segmentStartMs,
    segmentEndMs,
    continuesBefore: startMs < dayStartMs,
    continuesAfter: endMs > nextDayStartMs,
    conflicting,
  } satisfies ConflictAgendaTimedSegment;
}

export function buildConflictAgendaDays({
  proposal,
  scheduleContext,
}: {
  proposal: ConflictAgendaProposal;
  scheduleContext: CalendarScheduleContextItem[];
}): ConflictAgendaDay[] {
  return proposalDates(proposal).flatMap((date) => {
    const dayStartMs = midnightEpoch(date);
    const nextDayStartMs = midnightEpoch(addDaysYmd(date, 1));
    if (dayStartMs == null || nextDayStartMs == null) return [];
    const proposalSegment = timedSegment(
      "proposal",
      proposal.startMs,
      proposal.endMs,
      date,
      dayStartMs,
      nextDayStartMs,
      false,
    );
    if (!proposalSegment) return [];

    const timedContext = scheduleContext
      .filter((item) => !item.allDay)
      .map((item) => timedSegment(
        item.id,
        item.startMs,
        item.endMs,
        date,
        dayStartMs,
        nextDayStartMs,
        item.conflicting,
      ))
      .filter((item): item is ConflictAgendaTimedSegment => item !== null);
    const allDayContext = scheduleContext
      .filter((item) => item.allDay && item.startDate <= date && item.endDate >= date)
      .map((item) => ({
        sourceId: item.id,
        sourceStartMs: item.startMs,
        date,
        continuesBefore: item.startDate < date,
        continuesAfter: item.endDate > date,
      }));

    return [{
      date,
      dayStartMs,
      nextDayStartMs,
      proposal: proposalSegment,
      timedContext,
      allDayContext,
      hasConflict: timedContext.some((item) => item.conflicting),
    }];
  });
}

export function selectConflictAgendaEntries(days: ConflictAgendaDay[]): ConflictAgendaEntry[] {
  if (!days.length) return [];
  const selected = new Set<number>([0, days.length - 1]);
  days.forEach((day, index) => {
    if (day.hasConflict) selected.add(index);
  });

  const entries: ConflictAgendaEntry[] = [];
  let index = 0;
  while (index < days.length) {
    if (selected.has(index)) {
      const reasons: Array<"first" | "conflict" | "final"> = [];
      if (index === 0) reasons.push("first");
      if (days[index]!.hasConflict) reasons.push("conflict");
      if (index === days.length - 1) reasons.push("final");
      entries.push({ kind: "day", day: days[index]!, reasons });
      index += 1;
      continue;
    }

    const omittedStart = index;
    while (index < days.length && !selected.has(index)) index += 1;
    entries.push({
      kind: "omitted",
      startDate: days[omittedStart]!.date,
      endDate: days[index - 1]!.date,
      count: index - omittedStart,
    });
  }
  return entries;
}
