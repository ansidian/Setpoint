import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { moneyAhead } from "./moneyAheadModel";
import type { NeedsYouBill } from "../needsYou/needsYouModel";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
});
afterEach(() => { vi.useRealTimers(); });

it("counts today's and next week's unpaid bills once, excluding transfers and income", () => {
  const bills: NeedsYouBill[] = [
    { id: "today", type: "bill", name: "Electric", amount: 90, next_date: "2026-06-19" },
    { id: "future", scheduleId: "phone", type: "bill", name: "Phone", amount: 30.15, next_date: "2026-06-26" },
    { id: "duplicate", scheduleId: "phone", type: "bill", name: "Phone", amount: 30.15, next_date: "2026-06-26" },
    { id: "transfer", type: "transfer", name: "Card payment", amount: 500, next_date: "2026-06-20" },
    { id: "income", type: "income", name: "Paycheck", amount: 1000, next_date: "2026-06-20" },
    { id: "paid", type: "bill", name: "Paid bill", amount: 20, next_date: "2026-06-20", paid: true },
    { id: "past", type: "bill", name: "Past bill", amount: 40, next_date: "2026-06-18" },
    { id: "later", type: "bill", name: "Later bill", amount: 60, next_date: "2026-06-27" },
  ];
  const result = moneyAhead(bills);
  expect(result.upcoming.map(bill => bill.id)).toEqual(["today", "future"]);
  expect(result.amountsKnown).toBe(true);
  expect(result.total).toBe(120.15);
});

it("preserves eligible obligations with unknown amounts without claiming a complete total", () => {
  const result = moneyAhead([
    { id: "unknown", type: "bill", next_date: "2026-06-20" },
    { id: "known", type: "bill", amount: -12.34, next_date: "2026-06-19" },
  ]);
  expect(result.upcoming.map(bill => bill.id)).toEqual(["known", "unknown"]);
  expect(result.amountsKnown).toBe(false);
  expect(result.total).toBe(12.34);
});
