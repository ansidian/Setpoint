import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MoneyAheadCard from "./MoneyAheadCard";
import type { NeedsYouBill } from "../needsYou/needsYouModel";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

// The card owns obligation eligibility and totals. Exercise that financial
// contract with real classification inputs; visual inspection covers layout.
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
  render(<MoneyAheadCard bills={bills} loading={false} configured health={null} onOpen={() => {}} />);
  expect(screen.getByText("$120.15")).toBeTruthy();
  expect(screen.getByText(/2 upcoming obligations/)).toBeTruthy();
  expect(screen.queryByText("Card payment")).toBeNull();
  expect(screen.queryByText("Paycheck")).toBeNull();
});
