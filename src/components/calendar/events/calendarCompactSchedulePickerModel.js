import { addDaysYmd, parseYmd, ymdFromParts } from "../calendarDateUtils.js";
import { addMinutesToDraftDateTime } from "./calendarEditorUtils.js";

export function getCompactScheduleMonthCells(viewYear, viewMonth) {
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

export function monthFromDateKey(value, fallback = "2026-01-01") {
  const parsed = parseYmd(value) || parseYmd(fallback) || { year: 2026, month: 0 };
  return { year: parsed.year, month: parsed.month };
}

export function isDateInDraftRange(dateKey, draft) {
  const start = draft?.startDate || draft?.endDate;
  const end = draft?.endDate || draft?.startDate;
  return !!dateKey && !!start && !!end && dateKey >= start && dateKey <= end;
}

export function applyCompactScheduleDate(draft, field, value) {
  if (!value) return draft;
  if (field === "startDate") {
    return {
      ...draft,
      startDate: value,
      endDate: !draft.endDate || draft.endDate < value ? value : draft.endDate,
    };
  }
  if (field === "endDate") {
    return {
      ...draft,
      endDate: !draft.startDate || value >= draft.startDate ? value : draft.startDate,
    };
  }
  return draft;
}

export function applyCompactScheduleTime(draft, field, value) {
  const next = { ...draft, [field]: value };
  if (field === "startTime") {
    const seededEnd = addMinutesToDraftDateTime(next.startDate, value, 30);
    if (!next.endDate || next.endDate < seededEnd.date || next.endDate === draft.startDate) {
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
