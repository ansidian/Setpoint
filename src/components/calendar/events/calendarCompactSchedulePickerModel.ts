import { addDaysYmd, parseYmd, ymdFromParts } from "../calendarDateUtils.ts";
import { addMinutesToDraftDateTime, calendarDraftDurationMinutes } from "./calendarEditorUtils";

export interface CompactScheduleDraft {
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  [key: string]: unknown;
}

export type CompactScheduleDateField = "startDate" | "endDate";
export type CompactScheduleTimeField = "startTime" | "endTime";

export function getCompactScheduleMonthCells(viewYear: number, viewMonth: number) {
  const firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  return Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - firstDow;
    const cellDate = new Date(Date.UTC(viewYear, viewMonth, 1 + dayOffset, 12));
    const year = cellDate.getUTCFullYear();
    const month = cellDate.getUTCMonth();
    const day = cellDate.getUTCDate();
    return {
      year,
      month,
      day,
      dateKey: ymdFromParts(year, month, day),
      inMonth: month === viewMonth,
    };
  });
}

export function monthFromDateKey(value: string, fallback = "2026-01-01") {
  const parsed = parseYmd(value) || parseYmd(fallback) || { year: 2026, month: 0 };
  return { year: parsed.year, month: parsed.month };
}

export function isDateInDraftRange(dateKey: string, draft: CompactScheduleDraft | null | undefined) {
  const start = draft?.startDate || draft?.endDate;
  const end = draft?.endDate || draft?.startDate;
  return !!dateKey && !!start && !!end && dateKey >= start && dateKey <= end;
}

export function applyCompactScheduleDate<T extends CompactScheduleDraft>(
  draft: T,
  field: CompactScheduleDateField,
  value: string,
): T {
  if (!value) return draft;
  if (field === "startDate") {
    return {
      ...draft,
      startDate: value,
      endDate: !draft.endDate || draft.endDate < value ? value : draft.endDate,
    } as T;
  }
  if (field === "endDate") {
    return {
      ...draft,
      endDate: !draft.startDate || value >= draft.startDate ? value : draft.startDate,
    } as T;
  }
  return draft;
}

export function applyCompactScheduleTime<T extends CompactScheduleDraft>(
  draft: T,
  field: CompactScheduleTimeField,
  value: string,
  options: { preserveDurationOnStartChange?: boolean } = {},
): T {
  const next = { ...draft, [field]: value } as T;
  if (field === "startTime") {
    const preserveDuration = !!options.preserveDurationOnStartChange;
    const durationMinutes = preserveDuration ? calendarDraftDurationMinutes(draft) ?? 30 : 30;
    const seededEnd = addMinutesToDraftDateTime(next.startDate, value, durationMinutes);
    if (
      preserveDuration
      || !next.endDate
      || next.endDate < seededEnd.date
      || next.endDate === draft.startDate
    ) {
      next.endDate = seededEnd.date;
    }
    next.endTime = seededEnd.time;
  }
  if (
    next.startDate
    && next.endDate
    && next.startTime
    && next.endTime
    && next.endDate === next.startDate
    && next.endTime < next.startTime
  ) {
    next.endDate = addDaysYmd(next.startDate, 1);
  }
  return next;
}
