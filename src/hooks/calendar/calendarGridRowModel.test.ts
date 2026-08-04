import { describe, expect, it } from "vitest";

import { buildGridRows, leadingBoundaryType, renderedRows } from "./calendarGridRowModel";

describe("calendarGridRowModel", () => {
  it("preserves rendered row counts across boundary and leap-year invariants", () => {
    const cases = [
      [2026, 1, 4],
      [2026, 0, 5],
      [2026, 2, 4],
      [2026, 3, 4],
      [2026, 4, 5],
      [2026, 9, 5],
      [2026, 7, 5],
      [2028, 1, 4],
    ] as const;

    for (const [year, month, expectedRows] of cases) {
      expect(renderedRows(year, month), `${year}-${month + 1} row count`).toBe(expectedRows);
    }
  });

  it("keeps row shape and current-month coverage aligned with rendered rows", () => {
    const mayRows = buildGridRows(2026, 4);
    expect(mayRows).toHaveLength(renderedRows(2026, 4));
    expect(mayRows.every((row) => row.length === 7)).toBe(true);

    const mayCells = mayRows.flat().filter((cell) => cell.inCurrentMonth);
    expect(mayCells).toHaveLength(30);
    expect(mayCells.map((cell) => cell.dayOfMonth)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );

    const febRows = buildGridRows(2026, 1);
    expect(febRows).toHaveLength(renderedRows(2026, 1));
    expect(febRows.flat().every((cell) => cell.inCurrentMonth)).toBe(true);
  });

  it("preserves boundary date placement and date-key formatting", () => {
    const mayFirstRow = buildGridRows(2026, 4)[0]!;
    expect(mayFirstRow.filter((cell) => !cell.inCurrentMonth).map((cell) => cell.dayOfMonth)).toEqual([26, 27, 28, 29, 30]);
    expect(mayFirstRow[0]!.dateKey).toBe("2026-04-26");
    expect(mayFirstRow[4]!.dateKey).toBe("2026-04-30");
    expect(buildGridRows(2026, 4).flat().some((cell) => cell.dateKey.startsWith("2026-06"))).toBe(false);

    const febRows = buildGridRows(2026, 1);
    expect(febRows[0]![0]!.dateKey).toBe("2026-02-01");
    expect(febRows[3]![6]!.dateKey).toBe("2026-02-28");
  });

  it("preserves the L-shaped boundary border invariant", () => {
    const mayRows = buildGridRows(2026, 4);
    const firstRow = mayRows[0]!;

    expect(firstRow.slice(0, 5).every((cell) => cell.boundaryBorder.borderBottom)).toBe(true);
    expect(firstRow.slice(5).every((cell) => !cell.boundaryBorder.borderBottom)).toBe(true);
    expect(firstRow.slice(0, 4).every((cell) => !cell.boundaryBorder.borderRight)).toBe(true);
    expect(firstRow[4]!.boundaryBorder.borderRight).toBe(true);
    expect(mayRows.slice(1).flat().every((cell) => (
      !cell.boundaryBorder.borderBottom && !cell.boundaryBorder.borderRight
    ))).toBe(true);

    const febRows = buildGridRows(2026, 1);
    expect(febRows.flat().every((cell) => (
      !cell.boundaryBorder.borderBottom && !cell.boundaryBorder.borderRight
    ))).toBe(true);
  });

  it("classifies leading boundary shape by the first weekday invariant", () => {
    const cases = [
      [2026, 1, "straight"],
      [2026, 2, "straight"],
      [2022, 4, "straight"],
      [2026, 0, "step"],
      [2026, 4, "step"],
      [2026, 7, "step"],
    ] as const;

    for (const [year, month, expected] of cases) {
      expect(leadingBoundaryType(year, month), `${year}-${month + 1} boundary`).toBe(expected);
    }
  });

  it("keeps adjacent month coverage gap-free and non-overlapping", () => {
    for (const year of [2026, 2028]) {
      for (let month = 0; month < 11; month += 1) {
        const currentDates = buildGridRows(year, month).flat().map((cell) => cell.dateKey);
        const nextDates = buildGridRows(year, month + 1).flat().map((cell) => cell.dateKey);
        const currentSet = new Set(currentDates);
        const overlap = nextDates.filter((dateKey) => currentSet.has(dateKey));
        expect(overlap, `${year} months ${month} and ${month + 1} overlap`).toEqual([]);

        const lastDate = currentDates[currentDates.length - 1]!;
        const expectedFirst = new Date(`${lastDate}T00:00:00`);
        expectedFirst.setDate(expectedFirst.getDate() + 1);
        expect(nextDates[0], `${year} gap after month ${month}`).toBe(expectedFirst.toISOString().slice(0, 10));
      }
    }
  });
});
