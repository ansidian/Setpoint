const GRID_ROWS = 6;
const GRID_CELLS = GRID_ROWS * 7;

export interface CalendarVisibleDateRange {
  firstDate: string;
  lastDate: string;
}

export interface CalendarGridMonthMeta {
  firstDay: number;
  daysInMonth?: number;
}

export type CalendarAgendaBoundaryResult =
  | { crossed: false }
  | { crossed: true; targetMonth: { year: number; month: number } };

export function gridVisibleDateRange(
  { year, month }: { year: number; month: number },
  { firstDay }: CalendarGridMonthMeta,
): CalendarVisibleDateRange {
  const start = new Date(Date.UTC(year, month, 1 - firstDay, 12));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + GRID_CELLS - 1);
  return {
    firstDate: start.toISOString().slice(0, 10),
    lastDate: end.toISOString().slice(0, 10),
  };
}

export function agendaCrossesGridBoundary(
  topmostDate: string,
  visibleRange: CalendarVisibleDateRange,
): CalendarAgendaBoundaryResult {
  if (topmostDate >= visibleRange.firstDate && topmostDate <= visibleRange.lastDate) {
    return { crossed: false };
  }
  const year = Number(topmostDate.slice(0, 4));
  const month = Number(topmostDate.slice(5, 7)) - 1;
  return { crossed: true, targetMonth: { year, month } };
}

export function agendaTargetForGridMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
