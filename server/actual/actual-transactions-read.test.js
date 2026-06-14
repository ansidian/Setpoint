import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { readTransactionsRange } from "./actual-transactions-read.js";

let tempDir = null;

function settingsDbClient() {
  return {
    execute: async () => ({
      rows: [{
        actual_budget_url: "https://actual.example.test",
        actual_budget_password_encrypted: null,
        actual_budget_sync_id: "sync-123",
      }],
    }),
  };
}

// v_transactions modeled as a TABLE (the reader runs the same SQL whether it is a
// view or a table). Includes category/account, which the production view exposes
// but the existing fixtures omit.
async function writeFixture(budgetDir) {
  await mkdir(budgetDir, { recursive: true });
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({
    id: "Budget-1", cloudFileId: "file-1", groupId: "sync-123",
  }));
  const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
  await client.executeMultiple(`
    CREATE TABLE accounts (id TEXT, name TEXT, type TEXT, closed INTEGER, tombstone INTEGER);
    CREATE TABLE payees (id TEXT, name TEXT, transfer_acct TEXT, tombstone INTEGER);
    CREATE TABLE categories (id TEXT, name TEXT, cat_group TEXT, sort_order REAL, tombstone INTEGER);
    CREATE TABLE v_transactions (
      id TEXT, date INTEGER, amount INTEGER, payee TEXT, category TEXT, account TEXT, tombstone INTEGER
    );
    INSERT INTO accounts VALUES ('acct-1','Checking','checking',0,0),('acct-2','Amex','credit',0,0);
    INSERT INTO payees VALUES
      ('p-store','Trader Joes',NULL,0),
      ('p-rent','Landlord',NULL,0),
      ('p-job','Employer',NULL,0),
      ('p-xfer','Transfer to Amex','acct-2',0);
    INSERT INTO categories VALUES ('c-grocery','Groceries','g1',1,0),('c-rent','Rent','g1',2,0);
    INSERT INTO v_transactions VALUES
      ('t-grocery1', 20260505, -4210, 'p-store', 'c-grocery', 'acct-1', 0),
      ('t-grocery2', 20260518, -3990, 'p-store', 'c-grocery', 'acct-1', 0),
      ('t-rent',     20260501, -250000, 'p-rent', 'c-rent', 'acct-1', 0),
      ('t-income',   20260515, 500000, 'p-job', NULL, 'acct-1', 0),
      ('t-transfer', 20260510, -120000, 'p-xfer', NULL, 'acct-1', 0),
      ('t-old',      20260105, -9999, 'p-store', 'c-grocery', 'acct-1', 0)
    ;
  `);
  await client.close();
}

async function fixture() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-txn-read-"));
  await writeFixture(path.join(tempDir, "Budget-1"));
}

const opts = () => ({ dbClient: settingsDbClient(), dataDir: tempDir, localOnly: true });

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("readTransactionsRange", () => {
  it("returns expenses in range with resolved names, excluding income and transfers", async () => {
    await fixture();
    const { transactions } = await readTransactionsRange(
      "u1", { start: "2026-05-01", end: "2026-05-31" }, opts(),
    );
    const ids = transactions.map((t) => t.id);
    expect(ids).not.toContain("t-income");     // positive amount = income, excluded
    expect(ids).not.toContain("t-transfer");   // transfer payee, excluded
    expect(ids).not.toContain("t-old");        // outside the date window
    // date DESC within window: 05-18, 05-05, 05-01
    expect(ids).toEqual(["t-grocery2", "t-grocery1", "t-rent"]);
    const grocery = transactions.find((t) => t.id === "t-grocery1");
    expect(grocery).toMatchObject({
      date: "2026-05-05", amount: 42.10, payee: "Trader Joes",
      category: "Groceries", account: "Checking",
    });
  });

  it("applies payee/category/amount filters", async () => {
    await fixture();
    const byPayee = await readTransactionsRange("u1", {
      start: "2026-05-01", end: "2026-05-31", payee: "trader joes",
    }, opts());
    expect(byPayee.transactions.map((t) => t.id).sort()).toEqual(["t-grocery1", "t-grocery2"]);

    const byAmount = await readTransactionsRange("u1", {
      start: "2026-05-01", end: "2026-05-31", min_amount: 100,
    }, opts());
    expect(byAmount.transactions.map((t) => t.id)).toEqual(["t-rent"]);
  });

  it("reports an unknown filter instead of silently returning empty", async () => {
    await fixture();
    const result = await readTransactionsRange("u1", {
      start: "2026-05-01", end: "2026-05-31", category: "Nonexistent",
    }, opts());
    expect(result).toEqual({ unknownFilter: "category 'Nonexistent' not found" });
  });

  it("caps results and flags truncation", async () => {
    await fixture();
    const result = await readTransactionsRange("u1", {
      start: "2026-05-01", end: "2026-05-31", limit: 1,
    }, opts());
    expect(result.transactions).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});
