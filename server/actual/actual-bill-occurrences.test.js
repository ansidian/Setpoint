import { describe, expect, it } from "vitest";
import {
  buildBillOccurrencesFromSchedules,
  isSchedulePaid,
} from "./actual-bill-occurrences.js";

describe("Actual bill occurrence projection module", () => {
  it("projects open bill and transfer schedules into dated bill occurrences", () => {
    const occurrences = buildBillOccurrencesFromSchedules([
      {
        id: "s1",
        name: "Electricity",
        next_date: "2026-05-10",
        completed: false,
        type: "bill",
        conditions: [{ field: "amount", value: -12234 }, { field: "payee", value: "p1" }],
      },
      {
        id: "s2",
        name: "Visa transfer",
        next_date: "2026-05-12",
        completed: false,
        type: "transfer",
        conditions: [{ field: "amount", value: { num1: -5000 } }, { field: "payee", value: "p2" }],
      },
      {
        id: "s3",
        name: "Paycheck",
        next_date: "2026-05-15",
        completed: false,
        type: "income",
        conditions: [{ field: "amount", value: 100000 }],
      },
    ], {
      payeeMap: { p1: "SCE", p2: "Visa" },
      range: { start: "2026-05-01", end: "2026-05-31" },
    });

    expect(occurrences).toEqual([
      expect.objectContaining({
        id: "s1:2026-05-10",
        scheduleId: "s1",
        payee: "SCE",
        amount: 122.34,
        paid: false,
        openActionDisabled: false,
      }),
      expect.objectContaining({
        id: "s2:2026-05-12",
        scheduleId: "s2",
        payee: "Visa",
        amount: 50,
        type: "transfer",
      }),
    ]);
  });

  it("marks schedules paid from matching schedule transactions or close payee amount matches", () => {
    const schedule = {
      id: "s1",
      next_date: "2026-05-10",
      conditions: [{ field: "amount", value: -12234 }, { field: "payee", value: "p1" }],
    };

    expect(isSchedulePaid(schedule, [{ scheduleId: "s1", date: "2026-05-20" }])).toBe(true);
    expect(isSchedulePaid(schedule, [{ payeeId: "p1", amount: 122.34, date: "2026-05-12" }])).toBe(true);
    expect(isSchedulePaid(schedule, [{ payeeId: "p1", amount: 122.34, date: "2026-05-20" }])).toBe(false);
  });

  it("reports the midpoint figure for an isbetween (range) amount, not just num1", () => {
    const [occurrence] = buildBillOccurrencesFromSchedules([
      {
        id: "s4",
        name: "Water",
        next_date: "2026-05-18",
        completed: false,
        type: "bill",
        conditions: [
          { field: "amount", op: "isbetween", value: { num1: -4000, num2: -6000 } },
          { field: "payee", value: "p3" },
        ],
      },
    ], {
      payeeMap: { p3: "City Water" },
      range: { start: "2026-05-01", end: "2026-05-31" },
    });

    // Midpoint of $40 and $60 is $50 — the old code rendered only num1 ($40).
    expect(occurrence.amount).toBe(50);
  });

  it("detects a range schedule as paid for any transaction within the [num1, num2] band", () => {
    const schedule = {
      id: "s4",
      next_date: "2026-05-18",
      conditions: [
        { field: "amount", op: "isbetween", value: { num1: -4000, num2: -6000 } },
        { field: "payee", value: "p3" },
      ],
    };

    // Low end, high end, and middle of the band all match (within +/- a day).
    expect(isSchedulePaid(schedule, [{ payeeId: "p3", amount: 40, date: "2026-05-18" }])).toBe(true);
    expect(isSchedulePaid(schedule, [{ payeeId: "p3", amount: 60, date: "2026-05-18" }])).toBe(true);
    expect(isSchedulePaid(schedule, [{ payeeId: "p3", amount: 52.5, date: "2026-05-18" }])).toBe(true);
    // Outside the band stays unpaid.
    expect(isSchedulePaid(schedule, [{ payeeId: "p3", amount: 80, date: "2026-05-18" }])).toBe(false);
  });
});
