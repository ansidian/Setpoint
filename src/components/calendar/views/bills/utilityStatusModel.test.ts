import { describe, expect, it } from "vitest";
import {
  deriveUtilityStatus,
  pickBestUtilityMatch
} from "./utilityStatusModel.ts";
import type { UtilityStatus } from "./utilityStatusModel.ts";

// Pacific "today" used for the date-relative derivations. Pinning the system
// clock keeps daysUntil() (which reads todayPacific via new Date()) deterministic.
const TODAY = "2026-05-20";

function water(rows: UtilityStatus[]): UtilityStatus {
  return rows.find((row) => row.key === "water")!;
}

describe("pickBestUtilityMatch", () => {
  it("returns null when there are no matches", () => {
    expect(pickBestUtilityMatch([], TODAY)).toBeNull();
    expect(pickBestUtilityMatch(undefined, TODAY)).toBeNull();
  });

  it("prefers the soonest upcoming statement over a paid past one", () => {
    const upcomingSoon = { next_date: "2026-05-25", paid: false };
    const upcomingLater = { next_date: "2026-06-10", paid: false };
    const paidPast = { next_date: "2026-05-10", paid: true };
    const best = pickBestUtilityMatch([paidPast, upcomingLater, upcomingSoon], TODAY);
    expect(best).toBe(upcomingSoon);
  });

  it("falls back to the most recent paid past-due statement when nothing is upcoming", () => {
    const paidOld = { next_date: "2026-04-10", paid: true };
    const paidRecent = { next_date: "2026-05-10", paid: true };
    const best = pickBestUtilityMatch([paidOld, paidRecent], TODAY);
    expect(best).toBe(paidRecent);
  });

  it("falls back to the latest unpaid past-due entry when nothing is upcoming or paid", () => {
    const unpaidOld = { next_date: "2026-04-01", paid: false };
    const unpaidRecent = { next_date: "2026-05-01", paid: false };
    const best = pickBestUtilityMatch([unpaidOld, unpaidRecent], TODAY);
    expect(best).toBe(unpaidRecent);
  });
});

describe("deriveUtilityStatus", () => {
  it("matches a tracked utility against the mirrored bill payee name", () => {
    const rows = deriveUtilityStatus(
      {
        schedules: [
          { id: "water:2026-05-26", name: "Water Bill", payee: "SGV Water", next_date: "2026-05-26", amount: 50.67, paid: false },
        ],
        payeeMap: {},
      },
      TODAY,
    );
    const row = water(rows);
    expect(row.found).toBe(true);
    expect(row.next_date).toBe("2026-05-26");
    expect(row.amount).toBe(50.67);
    expect(row.isStale).toBe(false);
    expect(row.isHonored).toBe(false);
  });

  it("matches via the payeeMap value when the payee is referenced by a condition id", () => {
    const rows = deriveUtilityStatus(
      {
        schedules: [
          {
            id: "sched-1",
            name: "Monthly statement",
            next_date: "2026-05-26",
            paid: false,
            conditions: [
              { field: "payee", value: "payee-water" },
              { field: "amount", value: 5067 },
            ],
          },
        ],
        payeeMap: { "payee-water": "SGV Water" },
      },
      TODAY,
    );
    const row = water(rows);
    expect(row.found).toBe(true);
    expect(row.next_date).toBe("2026-05-26");
    // amount derived from the cents-valued amount condition
    expect(row.amount).toBeCloseTo(50.67, 2);
  });

  it("treats a paid past-due statement as honored, not stale", () => {
    const rows = deriveUtilityStatus(
      {
        schedules: [
          { id: "water:2026-05-10", name: "Water Bill", payee: "SGV Water", next_date: "2026-05-10", amount: 50.67, paid: true },
        ],
        payeeMap: {},
      },
      TODAY,
    );
    const row = water(rows);
    expect(row.found).toBe(true);
    expect(row.paid).toBe(true);
    expect(row.isHonored).toBe(true);
    expect(row.isStale).toBe(false);
  });

  it("treats an unpaid past-due statement as stale", () => {
    const rows = deriveUtilityStatus(
      {
        schedules: [
          { id: "water:2026-05-10", name: "Water Bill", payee: "SGV Water", next_date: "2026-05-10", amount: 50.67, paid: false },
        ],
        payeeMap: {},
      },
      TODAY,
    );
    const row = water(rows);
    expect(row.isStale).toBe(true);
    expect(row.isHonored).toBe(false);
  });

  it("looks past the visible range via allSchedules to locate a tracked utility", () => {
    const rows = deriveUtilityStatus(
      {
        // Visible range only carries Spectrum; the water statement lives in the
        // wider allSchedules set outside the visible window.
        schedules: [
          { id: "spectrum:2026-05-25", name: "Spectrum", payee: "Spectrum", next_date: "2026-05-25", amount: 50, paid: false },
        ],
        allSchedules: [
          { id: "spectrum:2026-05-25", name: "Spectrum", payee: "Spectrum", next_date: "2026-05-25", amount: 50, paid: false },
          { id: "water:2026-06-26", name: "Water Bill", payee: "SGV Water", next_date: "2026-06-26", amount: 50.67, paid: false },
        ],
        payeeMap: {},
      },
      TODAY,
    );
    const row = water(rows);
    expect(row.found).toBe(true);
    expect(row.next_date).toBe("2026-06-26");
  });

  it("marks untracked utilities not found and sorts dated rows ahead of undated ones", () => {
    const rows = deriveUtilityStatus(
      {
        schedules: [
          { id: "water:2026-05-26", name: "Water Bill", payee: "SGV Water", next_date: "2026-05-26", amount: 50.67, paid: false },
          { id: "sce:2026-05-22", name: "SCE", payee: "SCE", next_date: "2026-05-22", amount: 120, paid: false },
        ],
        payeeMap: {},
      },
      TODAY,
    );
    // Earliest dated utility first.
    expect(rows[0]!.key).toBe("sce");
    expect(rows[1]!.key).toBe("water");
    // Undated (not found) utilities sort to the end.
    expect(rows[rows.length - 1]!.found).toBe(false);
    expect(rows[rows.length - 1]!.next_date).toBeNull();
  });

  it("selects the soonest upcoming statement when both upcoming and recent-paid exist", () => {
    const rows = deriveUtilityStatus(
      {
        schedules: [
          { id: "water-paid", name: "Water Bill", payee: "SGV Water", next_date: "2026-05-10", amount: 40, paid: true },
          { id: "water-upcoming", name: "Water Bill", payee: "SGV Water", next_date: "2026-05-28", amount: 50.67, paid: false },
        ],
        payeeMap: {},
      },
      TODAY,
    );
    const row = water(rows);
    expect(row.next_date).toBe("2026-05-28");
    expect(row.isHonored).toBe(false);
  });
});
