import { describe, expect, it } from "vitest";

import { buildGridRows, leadingBoundaryType, renderedRows } from "./calendarGridRowModel.js";

describe("calendarGridRowModel", () => {
  describe("renderedRows", () => {
    it("returns 4 for Feb 2026 (starts Sunday, 28 days, no boundaries)", () => {
      expect(renderedRows(2026, 1)).toBe(4);
    });

    it("returns 5 for Jan 2026 (starts Thursday, ends Saturday — no trailing boundary)", () => {
      expect(renderedRows(2026, 0)).toBe(5);
    });

    it("returns 4 for Mar 2026 (starts Sunday, trailing boundary — gives away last row)", () => {
      expect(renderedRows(2026, 2)).toBe(4);
    });

    it("returns 4 for Apr 2026 (starts Wednesday, both boundaries)", () => {
      expect(renderedRows(2026, 3)).toBe(4);
    });

    it("returns 5 for May 2026 (starts Friday, 6 total rows, trailing boundary)", () => {
      expect(renderedRows(2026, 4)).toBe(5);
    });

    it("returns 5 for Oct 2026 (starts Thursday, ends Saturday — no trailing boundary)", () => {
      expect(renderedRows(2026, 9)).toBe(5);
    });

    it("returns 5 for Aug 2026 (starts Saturday, 6 total rows, trailing boundary)", () => {
      expect(renderedRows(2026, 7)).toBe(5);
    });

    it("returns 4 for Feb 2028 (leap year, starts Tuesday, trailing boundary)", () => {
      expect(renderedRows(2028, 1)).toBe(4);
    });
  });

  describe("buildGridRows", () => {
    it("returns correct number of rows matching renderedRows", () => {
      const rows = buildGridRows(2026, 4); // May 2026
      expect(rows).toHaveLength(renderedRows(2026, 4));
    });

    it("returns 7 cells per row", () => {
      const rows = buildGridRows(2026, 4); // May 2026
      for (const row of rows) {
        expect(row).toHaveLength(7);
      }
    });

    it("marks cells belonging to the grid month as inCurrentMonth", () => {
      // May 2026: trailing boundary row (May 31 + June dates) is given to June.
      // May's grid renders May 1–30 (30 inCurrentMonth cells).
      const rows = buildGridRows(2026, 4);
      const allCells = rows.flat();
      const mayCells = allCells.filter((c) => c.inCurrentMonth);
      expect(mayCells).toHaveLength(30);
      expect(mayCells[0].dayOfMonth).toBe(1);
      expect(mayCells[29].dayOfMonth).toBe(30);
    });

    it("includes leading boundary row with previous month dates for May 2026", () => {
      // May 2026 starts on Friday (offset 5), so row 0 has 5 April cells
      const rows = buildGridRows(2026, 4);
      const firstRow = rows[0];
      const aprilCells = firstRow.filter((c) => !c.inCurrentMonth);
      expect(aprilCells).toHaveLength(5);
      expect(aprilCells[0].dayOfMonth).toBe(26); // Apr 26 (Sunday)
      expect(aprilCells[4].dayOfMonth).toBe(30); // Apr 30 (Thursday)
    });

    it("excludes trailing boundary row (given to next month)", () => {
      // May 2026: 31 days, starts Friday. Last day (May 31) is Sunday.
      // The trailing boundary row (May 31 + June dates) should NOT be in May's grid.
      const rows = buildGridRows(2026, 4);
      const allCells = rows.flat();
      const juneCells = allCells.filter((c) => c.dateKey.startsWith("2026-06"));
      expect(juneCells).toHaveLength(0);
    });

    it("produces correct dateKeys in YYYY-MM-DD format", () => {
      const rows = buildGridRows(2026, 1); // Feb 2026, no boundaries
      expect(rows[0][0].dateKey).toBe("2026-02-01");
      expect(rows[3][6].dateKey).toBe("2026-02-28");
    });

    it("handles Feb 2026 with no boundaries (starts Sunday, ends Saturday)", () => {
      const rows = buildGridRows(2026, 1);
      expect(rows).toHaveLength(4);
      const allCells = rows.flat();
      expect(allCells.every((c) => c.inCurrentMonth)).toBe(true);
    });

    describe("boundary border classification (L-shaped)", () => {
      it("sets borderBottom on previous-month cells in the leading boundary row", () => {
        // May 2026: row 0 has 5 April cells
        const rows = buildGridRows(2026, 4);
        const firstRow = rows[0];
        for (let i = 0; i < 5; i++) {
          expect(firstRow[i].boundaryBorder.borderBottom).toBe(true);
        }
        // Current-month cells in the boundary row have no border
        for (let i = 5; i < 7; i++) {
          expect(firstRow[i].boundaryBorder.borderBottom).toBe(false);
        }
      });

      it("sets borderRight only on the last previous-month cell", () => {
        const rows = buildGridRows(2026, 4);
        const firstRow = rows[0];
        for (let i = 0; i < 4; i++) {
          expect(firstRow[i].boundaryBorder.borderRight).toBe(false);
        }
        expect(firstRow[4].boundaryBorder.borderRight).toBe(true); // Apr 30, last prev-month cell
      });

      it("has no boundary borders on non-boundary rows", () => {
        const rows = buildGridRows(2026, 4);
        for (let r = 1; r < rows.length; r++) {
          for (const cell of rows[r]) {
            expect(cell.boundaryBorder.borderBottom).toBe(false);
            expect(cell.boundaryBorder.borderRight).toBe(false);
          }
        }
      });

      it("has no cell-level boundary borders when month starts on Sunday (straight boundary)", () => {
        // Feb 2026 starts Sunday — straight boundary, no L-shaped step
        const rows = buildGridRows(2026, 1);
        for (const row of rows) {
          for (const cell of row) {
            expect(cell.boundaryBorder.borderBottom).toBe(false);
            expect(cell.boundaryBorder.borderRight).toBe(false);
          }
        }
      });
    });
  });

  describe("leadingBoundaryType", () => {
    it('returns "straight" when month starts on Sunday', () => {
      expect(leadingBoundaryType(2026, 1)).toBe("straight"); // Feb 2026
      expect(leadingBoundaryType(2026, 2)).toBe("straight"); // Mar 2026
      expect(leadingBoundaryType(2022, 4)).toBe("straight"); // May 2022
    });

    it('returns "step" when month has leading previous-month cells', () => {
      expect(leadingBoundaryType(2026, 0)).toBe("step"); // Jan 2026, Thursday
      expect(leadingBoundaryType(2026, 4)).toBe("step"); // May 2026, Friday
      expect(leadingBoundaryType(2026, 7)).toBe("step"); // Aug 2026, Saturday
    });
  });

  describe("row count invariant", () => {
    it("adjacent months cover every date exactly once for all of 2026", () => {
      for (let m = 0; m < 11; m++) {
        const rowsA = buildGridRows(2026, m);
        const rowsB = buildGridRows(2026, m + 1);
        const datesA = rowsA.flat().map((c) => c.dateKey);
        const datesB = rowsB.flat().map((c) => c.dateKey);
        const overlap = datesA.filter((d) => datesB.includes(d));
        expect(overlap, `months ${m} and ${m + 1} share dates: ${overlap.join(", ")}`).toEqual([]);
      }
    });

    it("adjacent months leave no date gaps for all of 2026", () => {
      for (let m = 0; m < 11; m++) {
        const rowsA = buildGridRows(2026, m);
        const rowsB = buildGridRows(2026, m + 1);
        const lastDateA = rowsA.at(-1).at(-1).dateKey;
        const firstDateB = rowsB[0][0].dateKey;
        const dayAfterA = new Date(lastDateA + "T00:00:00");
        dayAfterA.setDate(dayAfterA.getDate() + 1);
        const expected = dayAfterA.toISOString().slice(0, 10);
        expect(firstDateB, `gap between months ${m} and ${m + 1}`).toBe(expected);
      }
    });

    it("adjacent months cover every date exactly once for 2028 (leap year)", () => {
      for (let m = 0; m < 11; m++) {
        const rowsA = buildGridRows(2028, m);
        const rowsB = buildGridRows(2028, m + 1);
        const datesA = new Set(rowsA.flat().map((c) => c.dateKey));
        const datesB = rowsB.flat().map((c) => c.dateKey);
        const overlap = datesB.filter((d) => datesA.has(d));
        expect(overlap, `months ${m} and ${m + 1} share dates: ${overlap.join(", ")}`).toEqual([]);
      }
    });

    it("adjacent months leave no date gaps for 2028 (leap year)", () => {
      for (let m = 0; m < 11; m++) {
        const rowsA = buildGridRows(2028, m);
        const rowsB = buildGridRows(2028, m + 1);
        const lastDateA = rowsA.at(-1).at(-1).dateKey;
        const firstDateB = rowsB[0][0].dateKey;
        const dayAfterA = new Date(lastDateA + "T00:00:00");
        dayAfterA.setDate(dayAfterA.getDate() + 1);
        const expected = dayAfterA.toISOString().slice(0, 10);
        expect(firstDateB, `gap between months ${m} and ${m + 1}`).toBe(expected);
      }
    });
  });
});
