export function leadingBoundaryType(year, month) {
  const firstDayOffset = new Date(year, month, 1).getDay();
  return firstDayOffset > 0 ? "step" : "straight";
}

export function renderedRows(year, month) {
  const firstDayOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalRows = Math.ceil((firstDayOffset + daysInMonth) / 7);
  const hasTrailingBoundary = (firstDayOffset + daysInMonth) % 7 !== 0;
  return totalRows - (hasTrailingBoundary ? 1 : 0);
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function buildGridRows(year, month) {
  const firstDayOffset = new Date(year, month, 1).getDay();
  const rowCount = renderedRows(year, month);
  const startDate = new Date(year, month, 1 - firstDayOffset);

  const rows = [];
  const cursor = new Date(startDate);

  for (let r = 0; r < rowCount; r++) {
    const row = [];
    const isLeadingBoundaryRow = r === 0 && firstDayOffset > 0;

    let lastPrevMonthIndex = -1;
    if (isLeadingBoundaryRow) {
      lastPrevMonthIndex = firstDayOffset - 1;
    }

    for (let c = 0; c < 7; c++) {
      const inCurrentMonth = cursor.getMonth() === month && cursor.getFullYear() === year;
      const isPrevMonthCell = isLeadingBoundaryRow && c <= lastPrevMonthIndex;
      const isCurrentMonthBoundaryCell = isLeadingBoundaryRow && !isPrevMonthCell;

      row.push({
        dateKey: toDateKey(cursor),
        dayOfMonth: cursor.getDate(),
        inCurrentMonth,
        boundaryBorder: {
          borderBottom: isPrevMonthCell,
          borderRight: isPrevMonthCell && c === lastPrevMonthIndex,
          borderTop: isCurrentMonthBoundaryCell,
          borderLeft: isCurrentMonthBoundaryCell && c === lastPrevMonthIndex + 1,
        },
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.push(row);
  }

  return rows;
}
