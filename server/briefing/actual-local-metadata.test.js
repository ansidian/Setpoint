import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocalActualMetadata } from "./actual-local-metadata.js";

let tempDir = null;

function settingsDbClient({ encryptedPassword = null } = {}) {
  return {
    execute: async () => ({
      rows: [{
        actual_budget_url: "https://actual.example.test",
        actual_budget_password_encrypted: encryptedPassword,
        actual_budget_sync_id: "sync-123",
      }],
    }),
  };
}

async function writeBudgetFixture(budgetDir, {
  id = "Budget-1",
  cloudFileId = "file-1",
  accountName = "Checking",
} = {}) {
  await mkdir(budgetDir, { recursive: true });
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({
    id,
    cloudFileId,
    groupId: "sync-123",
  }));
  const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
  const safeAccountName = accountName.replaceAll("'", "''");
  await client.executeMultiple(`
    CREATE TABLE accounts (id TEXT, name TEXT, type TEXT, closed INTEGER, tombstone INTEGER);
    CREATE TABLE payees (id TEXT, name TEXT, transfer_acct TEXT, tombstone INTEGER);
    CREATE TABLE category_groups (id TEXT, name TEXT, sort_order REAL, tombstone INTEGER);
    CREATE TABLE categories (id TEXT, name TEXT, cat_group TEXT, sort_order REAL, tombstone INTEGER);
    CREATE TABLE v_schedules (
      id TEXT,
      name TEXT,
      rule TEXT,
      next_date INTEGER,
      completed INTEGER,
      tombstone INTEGER,
      _conditions TEXT
    );
    CREATE TABLE v_transactions (
      id TEXT,
      date INTEGER,
      amount INTEGER,
      payee TEXT,
      schedule TEXT,
      tombstone INTEGER
    );
    INSERT INTO accounts VALUES
      ('acct-1', '${safeAccountName}', 'checking', 0, 0),
      ('acct-closed', 'Closed', 'credit', 1, 0);
    INSERT INTO payees VALUES
      ('payee-1', 'Power Co', NULL, 0),
      ('transfer-payee', 'Transfer', 'acct-1', 0);
    INSERT INTO category_groups VALUES
      ('group-1', 'Bills', 1, 0),
      ('internal', 'Internal', 2, 0);
    INSERT INTO categories VALUES
      ('cat-1', 'Utilities', 'group-1', 1, 0),
      ('cat-internal', 'Transfer', 'internal', 1, 0);
    INSERT INTO v_schedules VALUES
      ('sched-1', 'Power Bill', 'rule-1', 20260510, 0, 0, '[{"field":"description","value":"payee-1"},{"field":"amount","value":-12234},{"field":"acct","value":"acct-1"}]'),
      ('sched-income', 'Paycheck', 'rule-2', 20260515, 0, 0, '[{"field":"description","value":"payee-1"},{"field":"amount","value":250000}]');
    INSERT INTO v_transactions VALUES
      ('txn-1', 20260511, -12234, 'payee-1', 'sched-1', 0),
      ('txn-zero', 20260512, 0, 'payee-1', NULL, 0);
  `);
  await client.close();
}

async function createActualBudgetFixture() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-actual-local-"));
  await writeBudgetFixture(path.join(tempDir, "Budget-1"));
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("readLocalActualMetadata", () => {
  it("projects Actual metadata from the local budget sqlite without the SDK", async () => {
    await createActualBudgetFixture();

    const metadata = await readLocalActualMetadata("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
    });

    expect(metadata.accounts).toEqual([{ id: "acct-1", name: "Checking", type: "checking" }]);
    expect(metadata.payees).toEqual([{ id: "payee-1", name: "Power Co" }]);
    expect(metadata.categories).toEqual([
      { group_name: "Bills", categories: [{ id: "cat-1", name: "Utilities" }] },
    ]);
    expect(metadata.schedules).toEqual([
      expect.objectContaining({
        id: "sched-1",
        next_date: "2026-05-10",
        type: "bill",
        conditions: expect.arrayContaining([
          expect.objectContaining({ field: "payee", value: "payee-1" }),
          expect.objectContaining({ field: "account", value: "acct-1" }),
        ]),
      }),
      expect.objectContaining({ id: "sched-income", type: "income" }),
    ]);
    expect(metadata.recentTransactions).toEqual([
      { payee: "Power Co", payeeId: "payee-1", amount: 122.34, date: "2026-05-11", scheduleId: "sched-1" },
    ]);
  });

  it("downloads a fresh budget zip when a refresh is explicitly requested", async () => {
    await createActualBudgetFixture();
    const remoteBudgetDir = path.join(tempDir, "Budget-Remote");
    await writeBudgetFixture(remoteBudgetDir, {
      id: "Budget-Remote",
      cloudFileId: "file-remote",
      accountName: "Fresh Checking",
    });
    const downloadBudget = vi.fn().mockResolvedValue({
      budgetDir: remoteBudgetDir,
      metadata: { id: "Budget-Remote", cloudFileId: "file-remote", groupId: "sync-123" },
    });

    const metadata = await readLocalActualMetadata("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
      refresh: true,
      downloadBudget,
    });

    expect(metadata.accounts).toEqual([{ id: "acct-1", name: "Fresh Checking", type: "checking" }]);
    expect(downloadBudget).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: "sync-123" }),
      expect.objectContaining({ refresh: true }),
    );
  });
});
