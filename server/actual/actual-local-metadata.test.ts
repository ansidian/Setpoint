import { mkdir, writeFile } from "fs/promises";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import path from "path";
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeLocalActualCache,
  hydrateLocalActualCache,
  readLocalActualMetadata,
} from "./actual-local-metadata.ts";

let tempDir: string | null = null;
const originalFetch = global.fetch;

function settingsDbClient({ encryptedPassword = null }: { encryptedPassword?: string | null } = {}) {
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

async function writeBudgetFixture(budgetDir: string, {
  id = "Budget-1",
  cloudFileId = "file-1",
  accountName = "Checking",
}: { id?: string; cloudFileId?: string; accountName?: string } = {}): Promise<void> {
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
      posts_transaction INTEGER DEFAULT 0,
      tombstone INTEGER,
      _conditions TEXT
    );
    CREATE TABLE v_transactions (
      id TEXT,
      date INTEGER,
      amount INTEGER,
      payee TEXT,
      account TEXT,
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
    INSERT INTO v_schedules(id,name,rule,next_date,completed,tombstone,_conditions) VALUES
      ('sched-1', 'Power Bill', 'rule-1', 20260510, 0, 0, '[{"field":"description","value":"payee-1"},{"field":"amount","value":-12234},{"field":"acct","value":"acct-1"}]'),
      ('sched-income', 'Paycheck', 'rule-2', 20260515, 0, 0, '[{"field":"description","value":"payee-1"},{"field":"amount","value":250000}]');
    INSERT INTO v_transactions(id,date,amount,payee,schedule,tombstone) VALUES
      ('txn-1', 20260511, -12234, 'payee-1', 'sched-1', 0),
      ('txn-zero', 20260512, 0, 'payee-1', NULL, 0);
  `);
  await client.close();
}

async function createActualBudgetFixture() {
  tempDir = await createTestTempDir("actual-local-");
  await writeBudgetFixture(path.join(tempDir!, "Budget-1"));
}

beforeEach(() => {
  // Fixture dates are fixed (May 2026); the recent-transaction window in
  // actual-local-metadata.ts is a rolling 30 days, so pin the clock or the
  // fixtures age out. Only Date is faked — async sqlite work needs real timers.
  vi.useFakeTimers({ now: new Date("2026-05-20T12:00:00-07:00"), toFake: ["Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  global.fetch = originalFetch;
  if (tempDir) await removeTempDir(tempDir);
  tempDir = null;
});

describe("readLocalActualMetadata", () => {
  it("describes an existing local Actual cache without downloading", async () => {
    await createActualBudgetFixture();

    const result = await describeLocalActualCache("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir!,
    });

    expect(result).toMatchObject({
      success: true,
      configured: true,
      hydrated: true,
      budgetId: "Budget-1",
      syncId: "sync-123",
      cloudFileId: "file-1",
      actualDataDir: tempDir,
    });
    expect(result.dbSizeBytes).toBeGreaterThan(0);
  });

  it("reports configured but not hydrated when the local Actual cache is missing", async () => {
    tempDir = await createTestTempDir("actual-local-");

    const result = await describeLocalActualCache("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir!,
    });

    expect(result).toMatchObject({
      success: true,
      configured: true,
      hydrated: false,
      syncId: "sync-123",
      actualDataDir: tempDir,
    });
  });

  it("projects Actual metadata from the local budget sqlite without the SDK", async () => {
    await createActualBudgetFixture();

    const metadata = await readLocalActualMetadata("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir!,
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
      { id: "txn-1", accountId: "", payee: "Power Co", payeeId: "payee-1", amount: 122.34, date: "2026-05-11", scheduleId: "sched-1" },
    ]);
  });

  it("fails without a network request when the local metadata is missing", async () => {
    tempDir = await createTestTempDir("actual-local-");
    global.fetch = vi.fn();

    await expect(readLocalActualMetadata("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
    })).rejects.toMatchObject({ status: 503 });

    // test-architecture: allow-boundary-interaction -- Disk reads must never contact the external Actual server, including on a cache miss.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the existing budget when bootstrap is requested again", async () => {
    await createActualBudgetFixture();
    global.fetch = vi.fn();

    const result = await hydrateLocalActualCache("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir!,
    });

    expect(result).toMatchObject({ success: true, hydrated: true, budgetId: "Budget-1" });
    const metadata = await readLocalActualMetadata("u1", { dbClient: settingsDbClient(), dataDir: tempDir! });
    expect(metadata.accounts).toEqual([{ id: "acct-1", name: "Checking", type: "checking" }]);
    // test-architecture: allow-boundary-interaction -- Bootstrap reuse must not download or synchronize over the external Actual boundary.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("openLocalBudgetClient opens the on-disk budget for direct queries", async () => {
    const { openLocalBudgetClient } = await import("./actual-local-metadata.ts");
    await createActualBudgetFixture();
    const client = await openLocalBudgetClient("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir!,
      localOnly: true,
    });
    const rows = await client.execute("SELECT id FROM accounts ORDER BY id");
    await client.close();
    expect(rows.rows.map((r) => r.id)).toContain("acct-1");
  });

  it("openLocalBudgetClient throws 503 when the local budget is missing", async () => {
    const { openLocalBudgetClient } = await import("./actual-local-metadata.ts");
    tempDir = await createTestTempDir("actual-local-");
    await expect(openLocalBudgetClient("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir!,
      localOnly: true,
    })).rejects.toMatchObject({ status: 503 });
  });


});
