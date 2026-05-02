import { describe, expect, it } from "vitest";
import { billMatchesItemId, compute } from "./billsModel.js";

describe("billsModel range data", () => {
  it("groups open schedule range instances by composite id", () => {
    const result = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        schedules: [
          { id: "s1:2026-05-10", scheduleId: "s1", name: "Electricity", amount: 100, next_date: "2026-05-10", paid: false, type: "bill" },
        ],
        recentTransactions: [],
      },
    });

    expect(result.itemsByDate["2026-05-10"].items).toEqual([
      expect.objectContaining({ id: "s1:2026-05-10", paid: false }),
    ]);
    expect(result.monthTotal).toBe(100);
  });

  it("matches dashboard-origin schedule ids against range instance ids", () => {
    expect(billMatchesItemId({ id: "s1:2026-05-10", scheduleId: "s1" }, "s1")).toBe(true);
    expect(billMatchesItemId({ id: "s1:2026-05-10", scheduleId: "s1" }, "s1:2026-05-10")).toBe(true);
    expect(billMatchesItemId({ id: "s1:2026-05-10", scheduleId: "s1" }, "s2")).toBe(false);
  });

  it("ignores recent transactions so completed bill history is not rendered", () => {
    const result = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        schedules: [],
        recentTransactions: [
          { transactionId: "tx1", name: "Old transfer", amount: 50, next_date: "2026-05-10", paid: true, type: "transfer" },
        ],
      },
    });

    expect(result.itemsByDate).toEqual({});
    expect(result.itemsByDay).toEqual({});
  });
});
