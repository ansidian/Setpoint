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
  expect(result.dueToday.map(bill => bill.id)).toEqual(["today"]);
  expect(result.future.map(bill => bill.id)).toEqual(["future"]);
  expect(result.pastDue.map(bill => bill.id)).toEqual(["past"]);
  expect(result.pastDueTotal).toBe(40);
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

it("retains only the previous 30 days, deduplicates each occurrence, and keeps past totals separate", () => {
  const result = moneyAhead([
    { id: "yesterday", scheduleId: "electric", next_date: "2026-06-18", amount: -90.12 },
    { id: "duplicate", scheduleId: "electric", next_date: "2026-06-18", amount: 90.12 },
    { id: "boundary", scheduleId: "electric", next_date: "2026-05-20", amount: 80.23 },
    { id: "too-old", next_date: "2026-05-19", amount: 500 },
    { id: "paid", next_date: "2026-06-18", amount: 10, paid: true },
    { id: "transfer", next_date: "2026-06-18", amount: 10, type: "transfer" },
    { id: "income", next_date: "2026-06-18", amount: 10, type: "income" },
    { id: "undated", amount: 10 },
    { id: "invalid-date", next_date: "invalid", amount: 10 },
  ]);
  expect(result.pastDue.map(bill => bill.id)).toEqual(["boundary", "yesterday"]);
  expect(result.pastDueAmountsKnown).toBe(true);
  expect(result.pastDueTotal).toBe(170.35);
  expect(result.upcoming).toEqual([]);
  expect(result.amountsKnown).toBe(true);
  expect(result.total).toBe(0);
});

it("keeps unknown past amounts from affecting the upcoming total", () => {
  const result = moneyAhead([
    { id: "past-unknown", next_date: "2026-06-18" },
    { id: "past-known", next_date: "2026-06-17", amount: 30.12 },
    { id: "today", next_date: "2026-06-19", amount: 90 },
  ]);
  expect(result.pastDueAmountsKnown).toBe(false);
  expect(result.pastDueTotal).toBe(30.12);
  expect(result.amountsKnown).toBe(true);
  expect(result.total).toBe(90);
});

it("does not claim complete totals for non-finite amounts", () => {
  const result = moneyAhead([
    { id: "nan", next_date: "2026-06-19", amount: NaN },
    { id: "infinite", next_date: "2026-06-18", amount: Infinity },
  ]);
  expect(result.amountsKnown).toBe(false);
  expect(result.pastDueAmountsKnown).toBe(false);
  expect(result.total).toBe(0);
  expect(result.pastDueTotal).toBe(0);
});

it("moves today's occurrence into past due at Pacific midnight and removes it when Actual records payment", () => {
  const bill: NeedsYouBill = { id: "electric", next_date: "2026-06-19", amount: 90, paid: false };
  vi.setSystemTime(new Date("2026-06-20T06:59:59Z"));
  expect(moneyAhead([bill]).dueToday).toEqual([bill]);
  vi.setSystemTime(new Date("2026-06-20T07:00:00Z"));
  const nextDay = moneyAhead([bill]);
  expect(nextDay.dueToday).toEqual([]);
  expect(nextDay.pastDue).toEqual([bill]);
  expect(moneyAhead([{ ...bill, paid: true }]).pastDue).toEqual([]);
});
