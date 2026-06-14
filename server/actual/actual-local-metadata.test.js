import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { createClient } from "@libsql/client";
import {
  SyncProtoBuf,
  Timestamp,
  makeClientId,
  makeClock,
  serializeClock,
} from "@actual-app/crdt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing__,
  describeLocalActualCache,
  hydrateLocalActualCache,
  pruneActualBudgetBackups,
  pruneLocalActualBackups,
  readLocalActualMetadata,
} from "./actual-local-metadata.js";

let tempDir = null;
const originalFetch = global.fetch;

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

function syncResponseBuffer(messages) {
  const response = new SyncProtoBuf.SyncResponse();
  response.setMerkle(JSON.stringify({}));
  for (const message of messages) {
    const messagePb = new SyncProtoBuf.Message();
    messagePb.setDataset(message.dataset);
    messagePb.setRow(message.row);
    messagePb.setColumn(message.column);
    messagePb.setValue(message.value);

    const envelopePb = new SyncProtoBuf.MessageEnvelope();
    envelopePb.setTimestamp(String(message.timestamp));
    envelopePb.setIsencrypted(false);
    envelopePb.setContent(messagePb.serializeBinary());
    response.addMessages(envelopePb);
  }
  return response.serializeBinary();
}

async function writeSyncPullFixture(budgetDir, { lastSyncedTimestamp } = {}) {
  await mkdir(budgetDir, { recursive: true });
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({
    id: "Budget-Sync",
    cloudFileId: "file-1",
    groupId: "sync-123",
    lastSyncedTimestamp,
  }));
  const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
  await client.executeMultiple(`
    CREATE TABLE accounts (id TEXT, name TEXT, type TEXT, closed INTEGER, tombstone INTEGER);
    CREATE TABLE payees (id TEXT, name TEXT, transfer_acct TEXT, tombstone INTEGER);
    CREATE TABLE payee_mapping (id TEXT PRIMARY KEY, targetId TEXT);
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
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      acct TEXT,
      amount INTEGER,
      description TEXT,
      date INTEGER,
      schedule TEXT,
      tombstone INTEGER,
      isChild INTEGER,
      parent_id TEXT,
      sort_order REAL
    );
    CREATE VIEW v_transactions AS
      SELECT t.id, t.date, t.amount, pm.targetId AS payee, t.schedule, t.tombstone
      FROM transactions t
      LEFT JOIN payee_mapping pm ON pm.id = t.description
      WHERE t.date IS NOT NULL
        AND t.acct IS NOT NULL
        AND (COALESCE(t.isChild, 0) = 0 OR t.parent_id IS NOT NULL);
    CREATE TABLE messages_crdt (
      id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL UNIQUE,
      dataset TEXT NOT NULL,
      row TEXT NOT NULL,
      column TEXT NOT NULL,
      value BLOB NOT NULL
    );
    CREATE TABLE messages_clock (id INTEGER PRIMARY KEY, clock TEXT);
    INSERT INTO accounts VALUES ('acct-1', 'Checking', 'checking', 0, 0);
    INSERT INTO payees VALUES ('payee-1', 'Power Co', NULL, 0);
    INSERT INTO payee_mapping VALUES ('payee-1', 'payee-1');
    INSERT INTO category_groups VALUES ('group-1', 'Bills', 1, 0);
    INSERT INTO categories VALUES ('cat-1', 'Utilities', 'group-1', 1, 0);
  `);
  const clock = makeClock(new Timestamp(0, 0, makeClientId()));
  await client.execute({
    sql: "INSERT INTO messages_clock (id, clock) VALUES (1, ?)",
    args: [serializeClock(clock)],
  });
  await client.close();
}

beforeEach(() => {
  // Fixture dates are fixed (May 2026); the recent-transaction window in
  // actual-local-metadata.js is a rolling 30 days, so pin the clock or the
  // fixtures age out. Only Date is faked — async sqlite work needs real timers.
  vi.useFakeTimers({ now: new Date("2026-05-20T12:00:00-07:00"), toFake: ["Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  global.fetch = originalFetch;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("readLocalActualMetadata", () => {
  it("describes an existing local Actual cache without downloading", async () => {
    await createActualBudgetFixture();

    const result = await describeLocalActualCache("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
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
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-actual-local-"));

    const result = await describeLocalActualCache("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
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

  it("applies remote sync deltas to a freshly downloaded Actual snapshot before reading transactions", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-actual-local-"));
    const budgetDir = path.join(tempDir, "Budget-Sync");
    const baseTimestamp = new Timestamp(1000, 0, makeClientId()).toString();
    await writeSyncPullFixture(budgetDir, { lastSyncedTimestamp: baseTimestamp });
    const remoteMessages = [
      { timestamp: new Timestamp(2000, 0, makeClientId()), dataset: "transactions", row: "txn-remote", column: "acct", value: "S:acct-1" },
      { timestamp: new Timestamp(2001, 0, makeClientId()), dataset: "transactions", row: "txn-remote", column: "amount", value: "N:-1888" },
      { timestamp: new Timestamp(2002, 0, makeClientId()), dataset: "transactions", row: "txn-remote", column: "description", value: "S:payee-1" },
      { timestamp: new Timestamp(2003, 0, makeClientId()), dataset: "transactions", row: "txn-remote", column: "date", value: "N:20260518" },
      { timestamp: new Timestamp(2004, 0, makeClientId()), dataset: "transactions", row: "txn-remote", column: "schedule", value: "S:sched-1" },
      { timestamp: new Timestamp(2005, 0, makeClientId()), dataset: "transactions", row: "txn-remote", column: "tombstone", value: "N:0" },
    ];
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => syncResponseBuffer(remoteMessages),
    });

    const syncResult = await __testing__.syncDownloadedBudget({
      serverURL: "https://actual.example.test",
    }, "token-1", {
      budgetDir,
      metadata: {
        id: "Budget-Sync",
        cloudFileId: "file-1",
        groupId: "sync-123",
        lastSyncedTimestamp: baseTimestamp,
      },
    });
    const metadata = await readLocalActualMetadata("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
      localOnly: true,
    });
    const savedMetadata = JSON.parse(await readFile(path.join(budgetDir, "metadata.json"), "utf8"));

    expect(syncResult).toMatchObject({ applied: 6, recorded: 6, since: baseTimestamp });
    expect(metadata.recentTransactions).toEqual([
      { payee: "Power Co", payeeId: "payee-1", amount: 18.88, date: "2026-05-18", scheduleId: "sched-1" },
    ]);
    expect(savedMetadata.lastSyncedTimestamp).toBe(String(remoteMessages.at(-1).timestamp));
    expect(global.fetch).toHaveBeenCalledWith(
      "https://actual.example.test/sync/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/actual-sync",
          "X-ACTUAL-TOKEN": "token-1",
        }),
      }),
    );
    const request = SyncProtoBuf.SyncRequest.deserializeBinary(global.fetch.mock.calls[0][1].body);
    expect(request.getSince()).toBe(baseTimestamp);
  });

  it("syncs the existing local budget when a refresh is explicitly requested", async () => {
    await createActualBudgetFixture();
    const syncedBudgetDir = path.join(tempDir, "synced-output", "Budget-Synced");
    await writeBudgetFixture(syncedBudgetDir, {
      id: "Budget-Synced",
      cloudFileId: "file-synced",
      accountName: "Fresh Checking",
    });
    const downloadBudget = vi.fn();
    const syncBudget = vi.fn().mockResolvedValue({
      budgetDir: syncedBudgetDir,
      metadata: { id: "Budget-Synced", cloudFileId: "file-synced", groupId: "sync-123" },
    });

    const metadata = await readLocalActualMetadata("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
      refresh: true,
      downloadBudget,
      syncBudget,
    });

    expect(metadata.accounts).toEqual([{ id: "acct-1", name: "Fresh Checking", type: "checking" }]);
    expect(syncBudget).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: "sync-123" }),
      expect.objectContaining({
        refresh: true,
        local: expect.objectContaining({
          budgetDir: path.join(tempDir, "Budget-1"),
          metadata: expect.objectContaining({ id: "Budget-1" }),
        }),
      }),
    );
    expect(downloadBudget).not.toHaveBeenCalled();
  });

  it("downloads a budget zip on refresh when no local cache exists", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-actual-local-"));
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
    const syncBudget = vi.fn();

    const metadata = await readLocalActualMetadata("u1", {
      dbClient: settingsDbClient(),
      dataDir: path.join(tempDir, "empty-cache"),
      refresh: true,
      downloadBudget,
      syncBudget,
    });

    expect(metadata.accounts).toEqual([{ id: "acct-1", name: "Fresh Checking", type: "checking" }]);
    expect(downloadBudget).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: "sync-123" }),
      expect.objectContaining({ refresh: true }),
    );
    expect(syncBudget).not.toHaveBeenCalled();
  });

  it("does not download from Actual when local-only metadata is requested", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-actual-local-"));
    const downloadBudget = vi.fn();

    await expect(readLocalActualMetadata("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
      localOnly: true,
      downloadBudget,
    })).rejects.toThrow("Actual Budget local metadata is unavailable");

    expect(downloadBudget).not.toHaveBeenCalled();
  });

  it("hydrates the local cache with an explicit hosted download and reports disk usage", async () => {
    await createActualBudgetFixture();
    const remoteBudgetDir = path.join(tempDir, "Budget-Remote");
    const backupDir = path.join(remoteBudgetDir, "backups");
    await writeBudgetFixture(remoteBudgetDir, {
      id: "Budget-Remote",
      cloudFileId: "file-remote",
      accountName: "Fresh Checking",
    });
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(backupDir, "latest.zip"), "backup");
    const downloadBudget = vi.fn().mockResolvedValue({
      budgetDir: remoteBudgetDir,
      metadata: { id: "Budget-Remote", cloudFileId: "file-remote", groupId: "sync-123" },
      backupPrune: { removed: 2, kept: 1 },
    });

    const result = await hydrateLocalActualCache("u1", {
      dbClient: settingsDbClient(),
      dataDir: tempDir,
      downloadBudget,
      forceDownload: true,
    });

    expect(downloadBudget).toHaveBeenCalledWith(
      expect.objectContaining({ syncId: "sync-123" }),
      expect.objectContaining({ refresh: true }),
    );
    expect(result).toMatchObject({
      success: true,
      hydrated: true,
      budgetId: "Budget-Remote",
      syncId: "sync-123",
      cloudFileId: "file-remote",
      budgetDir: remoteBudgetDir,
      actualDataDir: tempDir,
      backupCount: 1,
      backupSizeBytes: 6,
      backupPrune: { removed: 2, kept: 1 },
    });
    expect(result.dbSizeBytes).toBeGreaterThan(0);
  });

  it("keeps only the newest local Actual zip backup for a budget", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-actual-local-"));
    const budgetDir = path.join(tempDir, "My-Finances-d8e502a");
    const backupDir = path.join(budgetDir, "backups");
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({
      id: "My-Finances-d8e502a",
      cloudFileId: "file-1",
      groupId: "sync-123",
    }));
    await writeFile(path.join(backupDir, "old.zip"), "old");
    await writeFile(path.join(backupDir, "new.zip"), "new");
    await writeFile(path.join(backupDir, "db.latest.sqlite"), "latest");
    await utimes(path.join(backupDir, "old.zip"), new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));
    await utimes(path.join(backupDir, "new.zip"), new Date("2026-05-02T00:00:00Z"), new Date("2026-05-02T00:00:00Z"));

    const result = await pruneActualBudgetBackups(budgetDir, { keep: 1 });

    expect(result).toEqual({ removed: 1, kept: 1 });
    await expect(readdir(backupDir).then((files) => files.sort())).resolves.toEqual([
      "db.latest.sqlite",
      "new.zip",
    ]);
  });

  it("prunes backups across local Actual budget folders", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-actual-local-"));
    const budgetDir = path.join(tempDir, "My-Finances-d8e502a");
    const backupDir = path.join(budgetDir, "backups");
    await mkdir(backupDir, { recursive: true });
    await mkdir(path.join(tempDir, "not-a-budget", "backups"), { recursive: true });
    await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({
      id: "My-Finances-d8e502a",
      cloudFileId: "file-1",
      groupId: "sync-123",
    }));
    await writeFile(path.join(backupDir, "old.zip"), "old");
    await writeFile(path.join(backupDir, "new.zip"), "new");
    await utimes(path.join(backupDir, "old.zip"), new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));
    await utimes(path.join(backupDir, "new.zip"), new Date("2026-05-02T00:00:00Z"), new Date("2026-05-02T00:00:00Z"));

    const result = await pruneLocalActualBackups({ dataDir: tempDir, keep: 1 });

    expect(result).toEqual({ removed: 1, kept: 1, budgets: 1 });
    await expect(readdir(backupDir).then((files) => files.sort())).resolves.toEqual(["new.zip"]);
  });
});
