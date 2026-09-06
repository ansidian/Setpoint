import { describe, expect, it } from "vitest";
import { buildBillsAgendaGroups, reuseMultiMonthBillsAgendaGroups } from "./billsAgendaModel.ts";
import { compute } from "./billsModel.ts";
import type { BillScheduleInput, BillsViewData } from "./billsModel.ts";

const bill = (id: string, next_date: string, amount = 100): BillScheduleInput => ({ id, name: id, amount, next_date });
const bucket = (...bills: BillScheduleInput[]): BillsViewData => ({ schedules: bills, payeeMap: {} });

describe("reuseMultiMonthBillsAgendaGroups", () => {
  it("builds groups per loaded month, in order, from each month's bills bucket", () => {
    const buckets = new Map([
      ["2026-06", bucket(bill("june-rent", "2026-06-10"))],
      ["2026-07", bucket(bill("july-rent", "2026-07-12"))],
    ]);
    const getMonthBills = (year: number, month: number) => buckets.get(`${year}-${String(month + 1).padStart(2, "0")}`) || null;
    const { list } = reuseMultiMonthBillsAgendaGroups({
      previous: null,
      months: [{ year: 2026, month: 5 }, { year: 2026, month: 6 }],
      getMonthBills,
      todayKey: "2026-06-11",
    });
    expect(list.map((m) => m.monthKey)).toEqual(["2026-06", "2026-07"]);
    expect(list[0]!.visibleGroups.some((g) => g.dateKey === "2026-06-10")).toBe(true);
    expect(list[1]!.visibleGroups.some((g) => g.dateKey === "2026-07-12")).toBe(true);
  });
});

describe("buildBillsAgendaGroups transactions", () => {
  it("maps transaction direction and signed amounts into agenda rows", () => {
    const computed = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        schedules: [],
        transactions: [
          { id: "income-1", date: "2026-05-10", payee: "Employer", category: "Income", amount: 5000, direction: "income" },
          { id: "expense-1", date: "2026-05-10", payee: "Market", category: "Groceries", amount: 42.1, direction: "expense" },
        ],
      },
    });

    const result = buildBillsAgendaGroups({
      computed,
      viewYear: 2026,
      viewMonth: 4,
      todayKey: "2026-05-01",
    });
    const items = result.groups.find((group) => group.dateKey === "2026-05-10")!.items;

    expect(items).toEqual([
      expect.objectContaining({ agendaItemKind: "transaction", agendaMeta: "Inflow", agendaAmount: "+$5,000.00", agendaDotColor: "#89dceb" }),
      expect.objectContaining({ agendaItemKind: "transaction", agendaMeta: "Outflow", agendaAmount: "−$42.10", agendaDotColor: "#b4befe" }),
    ]);
  });
});
