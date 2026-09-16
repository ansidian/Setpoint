import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { readTransactionsRange } from "../actual/actual-transactions-read.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryTransactions, summarizeTransactions } from "./transactions-service.ts";
import type { TransactionFilters, TransactionRecord } from "../../shared/types/transactions.ts";

const ROWS: TransactionRecord[] = [
  { id: "a", date: "2026-05-05", amount: 42.10, direction: "expense", payee: "Trader Joes", category: "Groceries", account: "Checking", notes: "" },
  { id: "b", date: "2026-05-18", amount: 39.90, direction: "expense", payee: "Trader Joes", category: "Groceries", account: "Checking", notes: "" },
  { id: "c", date: "2026-04-30", amount: 60.00, direction: "expense", payee: "Shell", category: "Gas", account: "Amex", notes: "" },
];

const reader = (rows: TransactionRecord[] = ROWS, truncated = false) => vi.fn(async (_userId: string, _filters: TransactionFilters) => ({ transactions: rows, truncated }));
const stateCurrent = vi.fn(async (_userId: string) => ({ syncHealth: { state: "current" } }));

let tempDir: string | null = null;

afterEach(async () => {
  await removeTempDir(tempDir);
  tempDir = null;
});

describe("transaction facade filtering", () => {
  it.each([
    { label: "default expenses", direction: undefined, id: "coffee-expense", amount: 6 },
    { label: "income", direction: "income" as const, id: "coffee-refund", amount: 2 },
  ])("queries and summarizes notes-matching $label from the local budget", async ({ direction, id, amount }) => {
    tempDir = await createTestTempDir("transaction-service-");
    const budgetDir = path.join(tempDir, "Budget-1");
    await mkdir(budgetDir);
    await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({
      id: "Budget-1", cloudFileId: "file-1", groupId: "sync-123",
    }));
    const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
    try {
      await client.executeMultiple(`
        CREATE TABLE accounts (id TEXT, name TEXT, tombstone INTEGER);
        CREATE TABLE payees (id TEXT, name TEXT, transfer_acct TEXT, tombstone INTEGER);
        CREATE TABLE categories (id TEXT, name TEXT, tombstone INTEGER);
        CREATE TABLE v_transactions (
          id TEXT, imported_id TEXT, date INTEGER, amount INTEGER, payee TEXT,
          category TEXT, account TEXT, notes TEXT, tombstone INTEGER
        );
        INSERT INTO accounts VALUES ('checking', 'Checking', 0);
        INSERT INTO payees VALUES ('cafe', 'Cafe', NULL, 0);
        INSERT INTO categories VALUES ('dining', 'Dining', 0);
        INSERT INTO v_transactions VALUES
          ('coffee-expense', NULL, 20260505, -600, 'cafe', 'dining', 'checking', 'Coffee', 0),
          ('lunch', NULL, 20260506, -1500, 'cafe', 'dining', 'checking', 'Lunch', 0),
          ('coffee-refund', NULL, 20260507, 200, 'cafe', 'dining', 'checking', 'Coffee refund', 0),
          ('other-refund', NULL, 20260508, 1000, 'cafe', 'dining', 'checking', 'Lunch refund', 0);
      `);
    } finally {
      client.close();
    }
    const options = {
      dataDir: tempDir,
      localOnly: true,
      dbClient: { execute: async () => ({ rows: [{
        actual_budget_url: "https://actual.example.test",
        actual_budget_password_encrypted: null,
        actual_budget_sync_id: "sync-123",
      }] }) },
    };
    const deps = {
      readRange: (userId: string, filters: TransactionFilters) => readTransactionsRange(userId, filters, options),
      mirrorState: stateCurrent,
    };
    const filters = { start: "2026-05-01", end: "2026-05-31", notes: "coffee", direction };

    const query = await queryTransactions("u1", filters, deps);
    expect(query.total).toBe(1);
    expect(query.transactions).toEqual([expect.objectContaining({ id, amount, direction: direction ?? "expense" })]);

    const summary = await summarizeTransactions("u1", filters, deps);
    expect(summary.total).toBe(amount);
    expect(summary.buckets).toEqual([{ label: "Dining", amount, count: 1 }]);
  });
});

describe("queryTransactions", () => {
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
