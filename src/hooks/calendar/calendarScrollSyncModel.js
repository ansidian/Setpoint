const GRID_ROWS = 6;
const GRID_CELLS = GRID_ROWS * 7;

export function gridVisibleDateRange({ year, month }, { firstDay }) {
  const start = new Date(Date.UTC(year, month, 1 - firstDay, 12));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + GRID_CELLS - 1);
  return {
    firstDate: start.toISOString().slice(0, 10),
    lastDate: end.toISOString().slice(0, 10),
  };
}

export function agendaCrossesGridBoundary(topmostDate, visibleRange) {
  if (topmostDate >= visibleRange.firstDate && topmostDate <= visibleRange.lastDate) {
    return { crossed: false };
  }
  const year = Number(topmostDate.slice(0, 4));
  const month = Number(topmostDate.slice(5, 7)) - 1;
  return { crossed: true, targetMonth: { year, month } };
}

export function agendaTargetForGridMonth(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
