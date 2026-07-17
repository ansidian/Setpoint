import { describe, expect, it } from "vitest";
import { compute as computeBills } from "./bills/billsModel.ts";
import { compute as computeDeadlines } from "./deadlines/deadlinesModel.ts";

describe("calendar adjacent date maps", () => {
  it("keeps bills addressable by full date outside the viewed month", () => {
    const computed = computeBills({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        schedules: [
          {
            id: "sce",
            name: "Electric",
            next_date: "2026-04-30",
            conditions: [{ field: "amount", value: 8400 }],
            paid: false,
          },
        ],
        recentTransactions: [
          {
            scheduleId: "sce",
            date: "2026-04-30",
            amount: 8400,
          },
        ],
        payeeMap: {},
      },
    });

    expect(computed.itemsByDay[30]).toBeUndefined();
    expect(computed.itemsByDate["2026-04-30"]!.items).toHaveLength(1);
    expect(computed.itemsByDate["2026-04-30"]!.items[0]!.name).toBe("Electric");
  });

  it("keeps deadlines addressable by full date outside the viewed month", () => {
    const computed = computeDeadlines({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        upcoming: [
          {
            id: "deadline-apr-30",
            title: "Essay",
            due_date: "2026-04-30",
            status: "incomplete",
          },
        ],
      },
    });

    expect(computed.itemsByDay[30]).toBeUndefined();
    expect(computed.itemsByDate["2026-04-30"]!.items[0]!.title).toBe("Essay");
  });
});
