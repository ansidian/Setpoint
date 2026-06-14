import { describe, it, expect, vi, afterEach } from "vitest";
import { sumBillsDueWithin } from "./railModel.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("sumBillsDueWithin", () => {
  it("sums every unpaid bill due within N days, not just the rail's 4-row preview", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T20:00:00Z")); // Pacific Jan 15, ~noon
    const bills = [
      { next_date: "2026-01-16", amount: 10 },
      { next_date: "2026-01-17", amount: 20 },
      { next_date: "2026-01-18", amount: 30 },
      { next_date: "2026-01-19", amount: 40 },
      { next_date: "2026-01-20", amount: 50 }, // 5th — was dropped by slice(0,4)
    ];
    expect(sumBillsDueWithin(bills, 7)).toBe(150);
  });

  it("excludes paid bills, overdue bills, and bills outside the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T20:00:00Z"));
    const bills = [
      { next_date: "2026-01-16", amount: 10, paid: true }, // paid → excluded
      { next_date: "2026-01-30", amount: 99 },             // >7 days → excluded
      { next_date: "2026-01-14", amount: 5 },              // overdue → excluded
      { next_date: "2026-01-17", amount: 7 },              // included
    ];
    expect(sumBillsDueWithin(bills, 7)).toBe(7);
  });

  it("returns 0 for an empty or missing list", () => {
    expect(sumBillsDueWithin([], 7)).toBe(0);
    expect(sumBillsDueWithin(undefined, 7)).toBe(0);
  });
});
