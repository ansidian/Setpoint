const GRID_ROWS = 6;

function cellBoundaryMeta(cell, index, suppressedBoundary) {
  const suppressedSides = suppressedBoundary?.dateKey === cell.dateKey
    ? new Set(suppressedBoundary.sides || [])
    : null;
  return {
    ...cell,
    boundarySides: suppressedSides
      ? cell.boundarySides.filter((side) => !suppressedSides.has(side))
      : cell.boundarySides,
    index,
    row: Math.floor(index / 7) + 1,
    column: (index % 7) + 1,
  };
}

function pushHorizontalBoundarySegments({ segments, cells, side }) {
  const byRow = new Map();
  cells.forEach((cell) => {
    if (!cell.boundarySides.includes(side)) return;
    const key = `${cell.row}:${cell.boundaryColor}`;
    const rowCells = byRow.get(key) || [];
    rowCells.push(cell);
    byRow.set(key, rowCells);
  });

  byRow.forEach((rowCells) => {
    const ordered = rowCells.sort((a, b) => a.column - b.column);
    let run = [];
    function flushRun() {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      segments.push({
        id: `${side}-${first.dateKey}-${last.dateKey}`,
        side,
        color: first.boundaryColor,
        row: first.row,
        columnStart: first.column,
        columnEnd: last.column + 1,
        startCap: first.boundarySides.includes("left"),
        endCap: last.boundarySides.includes("right"),
      });
      run = [];
    }

    ordered.forEach((cell) => {
      const prev = run[run.length - 1];
      if (!prev || cell.column === prev.column + 1) {
        run.push(cell);
        return;
      }
      flushRun();
      run.push(cell);
    });
    flushRun();
  });
}

function pushVerticalBoundarySegments({ segments, cells, side }) {
  const byColumn = new Map();
  cells.forEach((cell) => {
    if (!cell.boundarySides.includes(side)) return;
    const key = `${cell.column}:${cell.boundaryColor}`;
    const columnCells = byColumn.get(key) || [];
    columnCells.push(cell);
    byColumn.set(key, columnCells);
  });

  byColumn.forEach((columnCells) => {
    const ordered = columnCells.sort((a, b) => a.row - b.row);
    let run = [];
    function flushRun() {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      segments.push({
        id: `${side}-${first.dateKey}-${last.dateKey}`,
        side,
        color: first.boundaryColor,
        column: first.column,
        rowStart: first.row,
        rowEnd: last.row + 1,
        startCap: first.boundarySides.includes("top"),
        endCap: last.boundarySides.includes("bottom"),
      });
      run = [];
    }

    ordered.forEach((cell) => {
      const prev = run[run.length - 1];
      if (!prev || cell.row === prev.row + 1) {
        run.push(cell);
        return;
      }
      flushRun();
      run.push(cell);
    });
    flushRun();
  });
}

function buildBoundarySegments(monthCells, suppressedBoundary) {
  const cells = monthCells
    .map((cell, index) => cellBoundaryMeta(cell, index, suppressedBoundary))
    .filter((cell) => cell.boundarySides.length);
  const segments = [];
  pushHorizontalBoundarySegments({ segments, cells, side: "top" });
  pushHorizontalBoundarySegments({ segments, cells, side: "bottom" });
  pushVerticalBoundarySegments({ segments, cells, side: "left" });
  pushVerticalBoundarySegments({ segments, cells, side: "right" });
  return segments;
}

export default function CalendarMonthBoundaryOverlay({
  monthCells,
  layout,
  gridRowCount,
  fillGridHeight,
  suppressedBoundary = null,
}) {
  const boundaryStrokeWidth = 2;
  const segments = buildBoundarySegments(monthCells, suppressedBoundary);
  if (!segments.length) return null;

  return (
    <div
      data-testid="calendar-month-boundary-overlay"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        gridTemplateRows: fillGridHeight
          ? `repeat(${gridRowCount}, minmax(0, 1fr))`
          : `repeat(${GRID_ROWS}, ${layout.cellHeight}px)`,
        gap: layout.gridGap,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      {segments.map((segment) => {
        if (segment.side === "top" || segment.side === "bottom") {
          return (
            <span
              key={segment.id}
              data-testid={`calendar-month-boundary-${segment.id}`}
              data-boundary-side={segment.side}
              style={{
                gridColumn: `${segment.columnStart} / ${segment.columnEnd}`,
                gridRow: segment.row,
                alignSelf: segment.side === "top" ? "start" : "end",
                height: boundaryStrokeWidth,
                background: segment.color,
                borderTopLeftRadius: segment.side === "top" && segment.startCap ? 8 : 0,
                borderTopRightRadius: segment.side === "top" && segment.endCap ? 8 : 0,
                borderBottomLeftRadius: segment.side === "bottom" && segment.startCap ? 8 : 0,
                borderBottomRightRadius: segment.side === "bottom" && segment.endCap ? 8 : 0,
              }}
            />
          );
        }

        return (
          <span
            key={segment.id}
            data-testid={`calendar-month-boundary-${segment.id}`}
            data-boundary-side={segment.side}
            style={{
              gridColumn: segment.column,
              gridRow: `${segment.rowStart} / ${segment.rowEnd}`,
              justifySelf: segment.side === "left" ? "start" : "end",
              width: boundaryStrokeWidth,
              background: segment.color,
              borderTopLeftRadius: segment.side === "left" && segment.startCap ? 8 : 0,
              borderTopRightRadius: segment.side === "right" && segment.startCap ? 8 : 0,
              borderBottomLeftRadius: segment.side === "left" && segment.endCap ? 8 : 0,
              borderBottomRightRadius: segment.side === "right" && segment.endCap ? 8 : 0,
            }}
          />
        );
      })}
    </div>
  );
}
