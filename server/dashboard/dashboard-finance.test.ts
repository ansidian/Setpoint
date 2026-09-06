import { createClient, type Client } from "@libsql/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { getDashboardFinance } from "./dashboard-finance.ts";

describe("dashboard finance read facade", () => {
  let db: Client;
  let budget: Client;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await createTestTempDir("dashboard-finance-");
    const budgetDir = path.join(dataDir, "Budget-1");
    await mkdir(budgetDir);
    await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({ id: "Budget-1", cloudFileId: "file-1", groupId: "sync-123" }));
    db = createClient({ url: "file::memory:" });
    for (const migration of ["001_ea_tables.sql", "002_bills_mirror.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql", "053_transaction_import_financial_plans.sql", "055_generic_financial_email_imports.sql"]) {
      await db.executeMultiple(await readFile(new URL(`../db/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await db.executeMultiple(`
      INSERT INTO ea_settings (user_id, actual_budget_url, actual_budget_sync_id)
        VALUES ('owner', 'https://actual.example.test', 'sync-123');
      INSERT INTO ea_bills_mirror_state (user_id, status, actual_configured, last_success_at)
        VALUES ('owner', 'degraded', 1, '2026-03-30T12:00:00Z');
    `);
    budget = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
    await budget.executeMultiple(`
      CREATE TABLE accounts (id TEXT, name TEXT, tombstone INTEGER);
      CREATE TABLE payees (id TEXT, name TEXT, transfer_acct TEXT, tombstone INTEGER);
      CREATE TABLE categories (id TEXT, name TEXT, tombstone INTEGER);
      CREATE TABLE v_transactions (id TEXT, imported_id TEXT, date INTEGER, amount INTEGER, payee TEXT, category TEXT, account TEXT, notes TEXT, tombstone INTEGER);
      INSERT INTO accounts VALUES ('checking', 'Checking', 0);
      INSERT INTO payees VALUES ('store', 'Store', NULL, 0), ('transfer', 'Transfer', 'savings', 0);
      INSERT INTO categories VALUES ('food', 'Food', 0), ('rent', 'Rent', 0), ('travel', 'Travel', 0), ('other', 'Other', 0);
      INSERT INTO v_transactions VALUES
        ('previous', NULL, 20260228, -20000, 'store', 'food', 'checking', '', 0),
        ('old', NULL, 20260131, -50000, 'store', 'food', 'checking', '', 0),
        ('a', NULL, 20260301, -1010, 'store', 'food', 'checking', '', 0),
        ('b', NULL, 20260331, -2020, 'store', 'food', 'checking', '', 0),
        ('c', NULL, 20260315, -10000, 'store', 'rent', 'checking', '', 0),
        ('d', NULL, 20260315, -5000, 'store', 'travel', 'checking', '', 0),
        ('e', NULL, 20260315, -1000, 'store', 'other', 'checking', '', 0),
        ('income', NULL, 20260315, 999999, 'store', 'other', 'checking', '', 0),
        ('transfer', NULL, 20260315, -999999, 'transfer', NULL, 'checking', '', 0),
        ('future', NULL, 20260401, -10000, 'store', 'food', 'checking', '', 0),
        ('deleted', NULL, 20260315, -10000, 'store', 'food', 'checking', '', 1);
    `);
  });

  afterEach(async () => {
    db?.close();
    budget?.close();
    if (dataDir) await removeTempDir(dataDir);
  });

  function read(now = new Date("2026-04-01T06:00:00Z")) {
    return getDashboardFinance("owner", { now, dbClient: db, actualReadOptions: { dbClient: db, dataDir } });
  }

  it("compares expenses at the dashboard day boundary with explicit shortened-month ranges and freshness", async () => {
    const result = await read();
    expect(result.spending).toEqual({
      status: "ready",
      current: { start: "2026-03-01", end: "2026-03-31", total: 190.3 },
      previous: { start: "2026-02-01", end: "2026-02-28", total: 200 },
      previousPeriodClamped: true,
      categories: [{ label: "Rent", amount: 100, count: 1 }, { label: "Travel", amount: 50, count: 1 }, { label: "Food", amount: 30.3, count: 2 }],
      changeAmount: -9.7, changePercent: -4.9,
      syncState: "degraded", lastSyncedAt: "2026-03-30T12:00:00Z", error: null,
    });
    expect(result.activity).toEqual({ status: "ready", reviewCount: 0, review: [], recent: [], error: null });
  });

  it("compares matching dates only, without counting later dates in the previous month", async () => {
    const { spending } = await read(new Date("2026-03-15T18:00:00Z"));
    expect(spending.current).toEqual({ start: "2026-03-01", end: "2026-03-15", total: 170.1 });
    expect(spending.previous).toEqual({ start: "2026-02-01", end: "2026-02-15", total: 0 });
    expect(spending.previousPeriodClamped).toBe(false);
    expect(spending.changePercent).toBeNull();
  });

  it("does not present partial scan totals as complete spending", async () => {
    await budget.executeMultiple(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 50001)
      INSERT INTO v_transactions SELECT 'bulk-' || n, NULL, 20260315, -100, 'store', 'food', 'checking', '', 0 FROM numbers;`);
    const { spending, activity } = await read();
    expect(spending.status).toBe("unavailable");
    expect(spending.current.total).toBeNull();
    expect(spending.previous.total).toBeNull();
    expect(spending.categories).toEqual([]);
    expect(spending.error).toContain("read limit");
    expect(activity.status).toBe("ready");
  });

  it("keeps activity available when the local budget is unavailable", async () => {
    await db.execute("UPDATE ea_settings SET actual_budget_sync_id = 'missing-budget' WHERE user_id = 'owner'");
    const { spending, activity } = await read();
    expect(spending.status).toBe("unavailable");
    expect(spending.current.total).toBeNull();
    expect(spending.error).toContain("budget sync");
    expect(activity.status).toBe("ready");
  });
});
