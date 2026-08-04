import { describe, expect, it, vi } from "vitest";
import { queryTransactions, summarizeTransactions } from "./transactions-service.ts";
import type { TransactionFilters, TransactionRecord } from "../../shared/types/transactions.ts";

const ROWS: TransactionRecord[] = [
  { id: "a", date: "2026-05-05", amount: 42.10, direction: "expense", payee: "Trader Joes", category: "Groceries", account: "Checking", notes: "" },
  { id: "b", date: "2026-05-18", amount: 39.90, direction: "expense", payee: "Trader Joes", category: "Groceries", account: "Checking", notes: "" },
  { id: "c", date: "2026-04-30", amount: 60.00, direction: "expense", payee: "Shell", category: "Gas", account: "Amex", notes: "" },
];

const reader = (rows: TransactionRecord[] = ROWS, truncated = false) => vi.fn(async (_userId: string, _filters: TransactionFilters) => ({ transactions: rows, truncated }));
const stateCurrent = vi.fn(async (_userId: string) => ({ syncHealth: { state: "current" } }));

describe("queryTransactions", () => {
  it("forwards notes filter to readRange", async () => {
    const readRange = vi.fn(async (_userId: string, filters: TransactionFilters) => ({
      transactions: filters.notes === "coffee" ? ROWS : [],
      truncated: false,
    }));
    const result = await queryTransactions("u1", { start: "2026-05-01", end: "2026-05-31", notes: "coffee" }, {
      readRange, mirrorState: stateCurrent,
    });
    expect(result.transactions).toEqual(ROWS);
  });

  it("forwards direction:'income' to readRange", async () => {
    const readRange = vi.fn(async (_userId: string, filters: TransactionFilters) => ({
      transactions: filters.direction === "income" ? ROWS : [],
      truncated: false,
    }));
    const result = await queryTransactions("u1", { start: "2026-05-01", end: "2026-05-31", direction: "income" }, {
      readRange, mirrorState: stateCurrent,
    });
    expect(result.transactions).toEqual(ROWS);
  });

  it("returns the list with total and no sync_state when current", async () => {
    const result = await queryTransactions("u1", { start: "2026-04-01", end: "2026-05-31" }, {
      readRange: reader(), mirrorState: stateCurrent,
    });
    expect(result.total).toBe(3);
    expect(result.transactions).toHaveLength(3);
    expect(result.sync_state).toBeUndefined();
  });

  it("surfaces sync_state when the mirror is degraded", async () => {
    const result = await queryTransactions("u1", { start: "2026-04-01", end: "2026-05-31" }, {
      readRange: reader(), mirrorState: vi.fn(async () => ({ syncHealth: { state: "degraded" } })),
    });
    expect(result.sync_state).toBe("degraded");
  });

  it("passes through an unknown filter", async () => {
    const result = await queryTransactions("u1", { start: "2026-04-01", end: "2026-05-31", category: "Nope" }, {
      readRange: vi.fn(async () => ({ unknownFilter: "category 'Nope' not found" })),
      mirrorState: stateCurrent,
    });
    expect(result).toEqual({ total: 0, unknown_filter: "category 'Nope' not found" });
  });

  it("returns a graceful error when the budget copy is missing", async () => {
    const result = await queryTransactions("u1", { start: "2026-04-01", end: "2026-05-31" }, {
      readRange: vi.fn(async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); }),
      mirrorState: stateCurrent,
    });
    expect(result).toEqual({ error: "transactions unavailable — budget not synced" });
  });
});

describe("summarizeTransactions", () => {
  it("forwards notes filter to readRange", async () => {
    const readRange = vi.fn(async (_userId: string, filters: TransactionFilters) => ({
      transactions: filters.notes === "coffee" ? ROWS : [],
      truncated: false,
    }));
    const result = await summarizeTransactions("u1", { start: "2026-05-01", end: "2026-05-31", notes: "coffee" }, {
      readRange, mirrorState: stateCurrent,
    });
    expect(result.total).toBe(142);
  });

  it("forwards direction:'income' to readRange", async () => {
    const readRange = vi.fn(async (_userId: string, filters: TransactionFilters) => ({
      transactions: filters.direction === "income" ? ROWS : [],
      truncated: false,
    }));
    const result = await summarizeTransactions("u1", { start: "2026-05-01", end: "2026-05-31", direction: "income" }, {
      readRange, mirrorState: stateCurrent,
    });
    expect(result.total).toBe(142);
  });

  it("aggregates by category with total", async () => {
    const result = await summarizeTransactions("u1", { start: "2026-04-01", end: "2026-05-31", group_by: "category" }, {
      readRange: reader(), mirrorState: stateCurrent,
    });
    expect(result.total).toBe(142.00);
    expect(result.group_by).toBe("category");
    expect(result.buckets).toEqual([
      { label: "Groceries", amount: 82.00, count: 2 },
      { label: "Gas", amount: 60.00, count: 1 },
    ]);
    expect(result.period).toEqual({ start: "2026-04-01", end: "2026-05-31" });
  });

  it("aggregates by month and by payee", async () => {
    const byMonth = await summarizeTransactions("u1", { start: "2026-04-01", end: "2026-05-31", group_by: "month" }, {
      readRange: reader(), mirrorState: stateCurrent,
    });
    expect(byMonth.buckets).toEqual([
      { label: "2026-05", amount: 82.00, count: 2 },
      { label: "2026-04", amount: 60.00, count: 1 },
    ]);
    const byPayee = await summarizeTransactions("u1", { start: "2026-04-01", end: "2026-05-31", group_by: "payee" }, {
      readRange: reader(), mirrorState: stateCurrent,
    });
    expect(byPayee.buckets![0]).toEqual({ label: "Trader Joes", amount: 82.00, count: 2 });
  });

  it("caps to top 15 buckets and folds the rest into Other", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `x${i}`, date: "2026-05-01", amount: 20 - i, direction: "expense" as const, payee: `P${i}`, category: `Cat${i}`, account: "Checking", notes: "",
    }));
    const result = await summarizeTransactions("u1", { start: "2026-05-01", end: "2026-05-31", group_by: "category" }, {
      readRange: reader(many), mirrorState: stateCurrent,
    });
    expect(result.buckets).toHaveLength(16); // 15 + Other
    expect(result.buckets![15]!.label).toBe("Other");
    expect(result.buckets![15]!.count).toBe(5);
  });
});
