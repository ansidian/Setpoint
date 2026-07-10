import { describe, expect, it } from "vitest";
import { billMatchesItemId, compute, getDayState, payUrlForBill } from "./billsModel.js";

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

  it("does not create calendar items for a schedule with an invalid amount", () => {
    const result = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        schedules: [
          { id: "bad", name: "Invalid bill", amount: "not-a-number", next_date: "2026-05-10", paid: false, type: "bill" },
          { id: "missing", name: "Missing amount", amount: null, next_date: "2026-05-11", paid: false, type: "bill" },
          { id: "legacy", name: "Legacy invalid bill", next_date: "2026-05-12", paid: false, type: "bill", conditions: [{ field: "amount", value: { num1: "not-a-number" } }] },
        ],
      },
    });

    expect(result.itemsByDate).toEqual({});
    expect(result.itemsByDay).toEqual({});
    expect(result.monthTotal).toBe(0);
  });

  it("does not create calendar items for a transaction with an invalid amount", () => {
    const result = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        transactions: [
          { id: "bad-transaction", date: "2026-05-10", amount: "not-a-number", direction: "expense", payee: "Invalid transaction" },
          { id: "missing-transaction", date: "2026-05-11", amount: null, direction: "expense", payee: "Missing amount" },
        ],
      },
    });

    expect(result.itemsByDate).toEqual({});
    expect(result.itemsByDay).toEqual({});
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

  it("groups transactions with bills in finance-priority order", () => {
    const result = compute({
      viewYear: 2026,
      viewMonth: 4,
      data: {
        schedules: [
          { id: "paid", name: "Paid bill", amount: 20, next_date: "2026-05-10", paid: true, type: "bill" },
          { id: "open", name: "Open bill", amount: 10, next_date: "2026-05-10", paid: false, type: "bill" },
        ],
        transactions: [
          { id: "expense-small", date: "2026-05-10", amount: 5, direction: "expense", payee: "Coffee" },
          { id: "income-small", date: "2026-05-10", amount: 100, direction: "income", payee: "Refund" },
          { id: "expense-large", date: "2026-05-10", amount: 50, direction: "expense", payee: "Market" },
          { id: "income-large", date: "2026-05-10", amount: 5000, direction: "income", payee: "Employer" },
        ],
      },
    });

    const state = result.itemsByDate["2026-05-10"];
    expect(state.items.map((item) => item.id)).toEqual([
      "open",
      "paid",
      "income-large",
      "income-small",
      "expense-large",
      "expense-small",
    ]);
    expect(state.incomeItems).toHaveLength(2);
    expect(state.expenseItems).toHaveLength(2);
    expect(state.totalCount).toBe(6);
    expect(state.items[2]).toMatchObject({
      type: "transaction",
      date: "2026-05-10",
      name: "Employer",
      direction: "income",
    });
    expect(result.monthTotal).toBe(30);
  });
});

describe("getDayState identity (PERF-01 follow-up)", () => {
  it("returns the referentially-same grouped state for repeated calls with the same array reference", () => {
    const rawItems = [
      { id: "bill-1", name: "Rent", amount: 100, next_date: "2026-05-01", paid: false },
      { id: "bill-2", name: "Electricity", amount: 50, next_date: "2026-05-01", paid: true },
    ];

    const first = getDayState(rawItems);
    const second = getDayState(rawItems);

    expect(second).toBe(first);
  });

  it("recomputes when a different array reference is passed, even with identical content", () => {
    const rawItemsA = [{ id: "bill-1", name: "Rent", amount: 100, next_date: "2026-05-01", paid: false }];
    const rawItemsB = [{ id: "bill-1", name: "Rent", amount: 100, next_date: "2026-05-01", paid: false }];

    const stateA = getDayState(rawItemsA);
    const stateB = getDayState(rawItemsB);

    expect(stateB).not.toBe(stateA);
    expect(stateB).toEqual(stateA);
  });

  it("still short-circuits when handed an already-resolved dayState object", () => {
    const resolved = { activeItems: [], completedItems: [], items: [], activeCount: 0, completedCount: 0, totalCount: 0 };
    expect(getDayState(resolved)).toBe(resolved);
  });
});

describe("payUrlForBill", () => {
  it("returns the url for a matching scheduleId", () => {
    expect(payUrlForBill({ scheduleId: "s1" }, { s1: "https://pay" })).toBe("https://pay");
  });

  it("falls back to the bill id when scheduleId is absent", () => {
    expect(payUrlForBill({ id: "s9" }, { s9: "https://pay" })).toBe("https://pay");
  });

  it("returns null when there is no match or no id", () => {
    expect(payUrlForBill({ scheduleId: "s1" }, { s2: "https://x" })).toBeNull();
    expect(payUrlForBill({ scheduleId: "s1" }, {})).toBeNull();
    expect(payUrlForBill({ scheduleId: "s1" }, null)).toBeNull();
    expect(payUrlForBill({}, { s1: "https://x" })).toBeNull();
  });
});
