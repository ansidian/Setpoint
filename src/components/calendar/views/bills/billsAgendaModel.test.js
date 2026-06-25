import { describe, expect, it } from "vitest";
import { reuseMultiMonthBillsAgendaGroups } from "./billsAgendaModel.js";

const bill = (id, next_date, amount = 100) => ({ id, name: id, amount, next_date });
const bucket = (...bills) => ({ schedules: bills, payeeMap: {} });

describe("reuseMultiMonthBillsAgendaGroups", () => {
  it("builds groups per loaded month, in order, from each month's bills bucket", () => {
    const buckets = new Map([
      ["2026-06", bucket(bill("june-rent", "2026-06-10"))],
      ["2026-07", bucket(bill("july-rent", "2026-07-12"))],
    ]);
    const getMonthBills = (year, month) => buckets.get(`${year}-${String(month + 1).padStart(2, "0")}`) || null;
    const { list } = reuseMultiMonthBillsAgendaGroups({
      previous: null,
      months: [{ year: 2026, month: 5 }, { year: 2026, month: 6 }],
      getMonthBills,
      todayKey: "2026-06-11",
    });
    expect(list.map((m) => m.monthKey)).toEqual(["2026-06", "2026-07"]);
    expect(list[0].visibleGroups.some((g) => g.dateKey === "2026-06-10")).toBe(true);
    expect(list[1].visibleGroups.some((g) => g.dateKey === "2026-07-12")).toBe(true);
  });

  it("reuses a month's group identity when its bucket reference is unchanged, and rebuilds only the changed month", () => {
    const buckets = new Map([
      ["2026-06", bucket(bill("june-rent", "2026-06-10"))],
      ["2026-07", bucket(bill("july-rent", "2026-07-12"))],
    ]);
    const getMonthBills = (year, month) => buckets.get(`${year}-${String(month + 1).padStart(2, "0")}`) || null;
    const months = [{ year: 2026, month: 5 }, { year: 2026, month: 6 }];
    const args = { months, getMonthBills, todayKey: "2026-06-11" };

    const first = reuseMultiMonthBillsAgendaGroups({ previous: null, ...args });
    const second = reuseMultiMonthBillsAgendaGroups({ previous: first.cache, ...args });
    expect(second.list[0]).toBe(first.list[0]);
    expect(second.list[1]).toBe(first.list[1]);

    // A new bucket reference for July → only July rebuilds.
    buckets.set("2026-07", bucket(bill("july-water", "2026-07-20")));
    const third = reuseMultiMonthBillsAgendaGroups({ previous: second.cache, ...args });
    expect(third.list[0]).toBe(second.list[0]);
    expect(third.list[1]).not.toBe(second.list[1]);
    expect(third.list[1].visibleGroups.some((g) => g.dateKey === "2026-07-20")).toBe(true);
  });

  it("invalidates only the month containing a changed forceVisibleDateKey", () => {
    const getMonthBills = () => null;
    const months = [{ year: 2026, month: 4 }, { year: 2026, month: 5 }];
    const base = { months, getMonthBills, todayKey: "2026-05-01" };

    const first = reuseMultiMonthBillsAgendaGroups({ previous: null, ...base, forceVisibleDateKey: null });
    const second = reuseMultiMonthBillsAgendaGroups({ previous: first.cache, ...base, forceVisibleDateKey: "2026-06-20" });
    expect(second.list[0]).toBe(first.list[0]);
    expect(second.list[1]).not.toBe(first.list[1]);
    expect(second.list[1].visibleGroups.map((g) => g.dateKey)).toContain("2026-06-20");
  });
});
