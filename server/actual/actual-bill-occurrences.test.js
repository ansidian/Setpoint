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
});
