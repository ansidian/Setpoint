import { mkdir, writeFile } from "fs/promises";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import path from "path";
import { createClient } from "@libsql/client";
import {
  SyncRequestSchema,
  SyncResponseSchema,
  Timestamp,
  create,
  fromBinary,
  makeClientId,
  makeClock,
  serializeClock,
  toBinary,
} from "@actual-app/crdt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/encryption.ts", () => ({ decrypt: (value: unknown) => value }));

const { sendBillLightweight } = await import("./actual-lightweight-writes.ts");

let tempDir: string | null = null;
const originalDataDir = process.env.ACTUAL_DATA_DIR;
const originalFetch = global.fetch;
let fetchMock = vi.fn();

function settingsDbClient() {
  return {
    execute: async () => ({
      rows: [{
        actual_budget_url: "https://actual.example.test",
        actual_budget_password_encrypted: "actual-password",
        actual_budget_sync_id: "sync-123",
      }],
    }),
  };
}

function syncResponseBuffer() {
  const response = create(SyncResponseSchema, { merkle: JSON.stringify({}) });
  return toBinary(SyncResponseSchema, response);
}

function mockActualRequests(count = 1): void {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  for (let i = 0; i < count; i += 1) {
    fetchMock
      .mockResolvedValueOnce({
        text: async () => JSON.stringify({ data: { token: `token-${i + 1}` } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => syncResponseBuffer(),
      });
  }
}

async function createBudgetDb() {
  tempDir = await createTestTempDir("actual-lightweight-");
  const budgetDir = path.join(tempDir, "My-Finances-d8e502a");
  await mkdir(budgetDir, { recursive: true });
  await writeFile(path.join(budgetDir, "metadata.json"), JSON.stringify({
    id: "My-Finances-d8e502a",
    cloudFileId: "cloud-file-1",
    groupId: "sync-123",
    encryptKeyId: null,
  }));

  const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
  await client.executeMultiple(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, type TEXT, closed INTEGER, tombstone INTEGER);
    CREATE TABLE payees (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER, transfer_acct TEXT);
    CREATE TABLE payee_mapping (id TEXT PRIMARY KEY, targetId TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, tombstone INTEGER);
    CREATE TABLE rules (
      id TEXT PRIMARY KEY,
      stage TEXT,
      conditions TEXT,
      actions TEXT,
      tombstone INTEGER DEFAULT 0,
      conditions_op TEXT DEFAULT 'and'
    );
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      rule TEXT,
      active INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      posts_transaction INTEGER DEFAULT 0,
      tombstone INTEGER DEFAULT 0,
      name TEXT
    );
    CREATE TABLE schedules_next_date (
      id TEXT PRIMARY KEY,
      schedule_id TEXT,
      local_next_date INTEGER,
      local_next_date_ts INTEGER,
      base_next_date INTEGER,
      base_next_date_ts INTEGER,
      tombstone INTEGER DEFAULT 0
    );
    CREATE TABLE schedules_json_paths (
      schedule_id TEXT PRIMARY KEY,
      payee TEXT,
      account TEXT,
      amount TEXT,
      date TEXT
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      acct TEXT,
      category TEXT,
      amount INTEGER,
      description TEXT,
      notes TEXT,
      date INTEGER,
      cleared INTEGER DEFAULT 1,
      sort_order REAL,
      tombstone INTEGER DEFAULT 0,
      raw_synced_data TEXT
    );
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
    INSERT INTO accounts VALUES ('acct-card', 'Visa', 'credit', 0, 0);
    INSERT INTO payees VALUES ('transfer-payee-1', 'Transfer: Checking', 0, 'acct-1');
    INSERT INTO categories VALUES ('cat-1', 'Utilities', 0);
  `);
  const clock = makeClock(new Timestamp(0, 0, makeClientId()));
  await client.execute({
    sql: "INSERT INTO messages_clock (id, clock) VALUES (1, ?)",
    args: [serializeClock(clock)],
  });
  await client.close();
  process.env.ACTUAL_DATA_DIR = tempDir;
  return budgetDir;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockActualRequests();
});
afterEach(async () => {
  global.fetch = originalFetch;
  if (originalDataDir == null) delete process.env.ACTUAL_DATA_DIR;
  else process.env.ACTUAL_DATA_DIR = originalDataDir;
  if (tempDir) await removeTempDir(tempDir);
  tempDir = null;
});
describe("sendBillLightweight", () => {
  it("writes an expense transaction into the local Actual DB and syncs CRDT messages", async () => {
    const budgetDir = await createBudgetDb();

    const result = await sendBillLightweight("u1", {
      type: "expense",
      payee: "Power Co",
      amount: 12.34,
      due_date: "2026-05-20",
      account_id: "acct-1",
      category_id: "cat-1",
      notes: "Statement ready",
    }, {
      dbClient: settingsDbClient(),
      now: new Date("2026-05-15T12:00:00.000Z"),
    });

    expect(result).toMatchObject({ success: true, lightweight: true });
    const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
    const payees = await client.execute("SELECT id, name FROM payees WHERE transfer_acct IS NULL");
    const txns = await client.execute("SELECT acct, category, amount, description, notes, date, cleared FROM transactions");
    const messages = await client.execute("SELECT dataset, row, column, value FROM messages_crdt ORDER BY id");
    await client.close();

    expect(payees.rows).toEqual([expect.objectContaining({ name: "Power Co" })]);
    expect(txns.rows).toEqual([expect.objectContaining({
      acct: "acct-1",
      category: "cat-1",
      amount: -1234,
      notes: "Statement ready",
      date: 20260520,
      cleared: 1,
    })]);
    expect(txns.rows[0]!.description).toBe(payees.rows[0]!.id);
    expect(messages.rows.map((row) => row.dataset)).toEqual(expect.arrayContaining([
      "payees",
      "payee_mapping",
      "transactions",
    ]));

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://actual.example.test/account/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://actual.example.test/sync/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/actual-sync",
          "X-ACTUAL-TOKEN": "token-1",
        }),
      }),
    );
    const syncBody = (fetchMock.mock.calls[1]![1] as RequestInit).body as Uint8Array;
    const request = fromBinary(SyncRequestSchema, syncBody);
    expect(request.groupId).toBe("sync-123");
    expect(request.fileId).toBe("cloud-file-1");
    expect(request.messages.length).toBeGreaterThan(0);
  });

  it("records lastPushedTimestamp after a successful sync so the next since-window can't drop unsynced messages (P2-15)", async () => {
    const budgetDir = await createBudgetDb();

    await sendBillLightweight("u1", {
      type: "expense",
      payee: "Power Co",
      amount: 12.34,
      due_date: "2026-05-20",
      account_id: "acct-1",
      category_id: "cat-1",
    }, {
      dbClient: settingsDbClient(),
      now: new Date("2026-05-15T12:00:00.000Z"),
    });

    const metadata = JSON.parse(await (await import("fs/promises")).readFile(path.join(budgetDir, "metadata.json"), "utf8")) as { lastPushedTimestamp?: string };
    expect(typeof metadata.lastPushedTimestamp).toBe("string");
    expect(metadata.lastPushedTimestamp!.length).toBeGreaterThan(0);
  });

  it("writes a future bill schedule into the local Actual DB and syncs schedule CRDT messages", async () => {
    const budgetDir = await createBudgetDb();

    const result = await sendBillLightweight("u1", {
      type: "bill",
      payee: "Power Co",
      amount: 12.34,
      due_date: "2026-05-20",
      account_id: "acct-1",
      category_id: "cat-1",
    }, {
      dbClient: settingsDbClient(),
      now: new Date("2026-05-15T12:00:00.000Z"),
    });

    const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
    const payees = await client.execute("SELECT id, name FROM payees WHERE transfer_acct IS NULL");
    const schedules = await client.execute("SELECT id, name, rule, completed FROM schedules");
    const rules = await client.execute("SELECT conditions, actions, conditions_op FROM rules");
    const nextDates = await client.execute("SELECT schedule_id, local_next_date, base_next_date FROM schedules_next_date");
    const paths = await client.execute("SELECT schedule_id, payee, account, amount, date FROM schedules_json_paths");
    const txns = await client.execute("SELECT id FROM transactions");
    const messages = await client.execute("SELECT dataset, row, column FROM messages_crdt ORDER BY id");
    await client.close();

    expect(result).toMatchObject({ success: true, lightweight: true, scheduleId: schedules.rows[0]!.id });
    expect(payees.rows).toEqual([expect.objectContaining({ name: "Power Co" })]);
    expect(txns.rows).toEqual([]);
    expect(schedules.rows).toEqual([expect.objectContaining({
      name: "Power Co",
      completed: 0,
    })]);
    expect(nextDates.rows).toEqual([expect.objectContaining({
      schedule_id: schedules.rows[0]!.id,
      local_next_date: 20260520,
      base_next_date: 20260520,
    })]);
    expect(JSON.parse(String(rules.rows[0]!.conditions))).toEqual([
      { op: "is", field: "date", value: "2026-05-20" },
      { op: "is", field: "amount", value: -1234 },
      { op: "is", field: "description", value: payees.rows[0]!.id },
      { op: "is", field: "acct", value: "acct-1" },
    ]);
    expect(JSON.parse(String(rules.rows[0]!.actions))).toEqual([
      { op: "link-schedule", value: schedules.rows[0]!.id },
    ]);
    expect(rules.rows[0]!.conditions_op).toBe("and");
    expect(paths.rows).toEqual([expect.objectContaining({
      schedule_id: schedules.rows[0]!.id,
      payee: "$[2]",
      account: "$[3]",
      amount: "$[1]",
      date: "$[0]",
    })]);
    expect(messages.rows.map((row) => row.dataset)).toEqual(expect.arrayContaining([
      "payees",
      "payee_mapping",
      "rules",
      "schedules_next_date",
      "schedules",
    ]));
  });

  it("writes a future transfer schedule with Actual's transfer payee and no SDK worker", async () => {
    const budgetDir = await createBudgetDb();

    const result = await sendBillLightweight("u1", {
      type: "transfer",
      amount: 43.21,
      due_date: "2026-05-22",
      from_account_id: "acct-1",
      to_account_id: "acct-card",
      schedule_name: "Visa Payment",
    }, {
      dbClient: settingsDbClient(),
      now: new Date("2026-05-15T12:00:00.000Z"),
    });

    const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
    const payees = await client.execute("SELECT id, name, transfer_acct FROM payees ORDER BY id");
    const schedules = await client.execute("SELECT id, name, rule FROM schedules");
    const rules = await client.execute("SELECT conditions, actions FROM rules");
    const messages = await client.execute("SELECT dataset FROM messages_crdt ORDER BY id");
    await client.close();

    expect(result).toMatchObject({ success: true, lightweight: true, scheduleId: schedules.rows[0]!.id });
    expect(payees.rows).toEqual([
      expect.objectContaining({ id: "transfer-payee-1", transfer_acct: "acct-1" }),
    ]);
    expect(schedules.rows).toEqual([expect.objectContaining({ name: "Visa Payment" })]);
    expect(JSON.parse(String(rules.rows[0]!.conditions))).toEqual([
      { op: "is", field: "date", value: "2026-05-22" },
      { op: "is", field: "amount", value: 4321 },
      { op: "is", field: "description", value: "transfer-payee-1" },
      { op: "is", field: "acct", value: "acct-card" },
    ]);
    expect(JSON.parse(String(rules.rows[0]!.actions))).toEqual([
      { op: "link-schedule", value: schedules.rows[0]!.id },
    ]);
    expect(messages.rows.map((row) => row.dataset)).toEqual(expect.arrayContaining([
      "rules",
      "schedules_next_date",
      "schedules",
    ]));
    expect(messages.rows.map((row) => row.dataset)).not.toContain("payee_mapping");
  });

  it("updates an existing future bill schedule instead of creating duplicates", async () => {
    mockActualRequests(2);
    const budgetDir = await createBudgetDb();
    const options = {
      dbClient: settingsDbClient(),
      now: new Date("2026-05-15T12:00:00.000Z"),
    };

    await sendBillLightweight("u1", {
      type: "bill",
      payee: "Power Co",
      amount: 12.34,
      due_date: "2026-05-20",
      account_id: "acct-1",
    }, options);
    const intermediateClient = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
    await intermediateClient.execute("UPDATE schedules SET posts_transaction = 1, active = 1");
    await intermediateClient.close();
    const result = await sendBillLightweight("u1", {
      type: "bill",
      payee: "Power Co",
      amount: 15,
      due_date: "2026-05-25",
      account_id: "acct-1",
    }, options);

    const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
    const schedules = await client.execute("SELECT id, name, rule, posts_transaction, active FROM schedules");
    const rules = await client.execute("SELECT conditions FROM rules");
    const nextDates = await client.execute("SELECT local_next_date, base_next_date FROM schedules_next_date");
    await client.close();

    expect(result.message).toBe('Updated schedule "Power Co"');
    expect(schedules.rows).toEqual([expect.objectContaining({
      active: 1,
      posts_transaction: 1,
    })]);
    expect(JSON.parse(String(rules.rows[0]!.conditions))).toEqual(expect.arrayContaining([
      { op: "is", field: "date", value: "2026-05-25" },
      { op: "is", field: "amount", value: -1500 },
    ]));
    expect(nextDates.rows).toEqual([expect.objectContaining({
      local_next_date: 20260525,
      base_next_date: 20260525,
    })]);
  });

  it("flags a mid-sync failure as locally applied and leaves a recoverable state", async () => {
    const budgetDir = await createBudgetDb();
    fetchMock = vi.fn()
      .mockResolvedValueOnce({
        text: async () => JSON.stringify({ data: { token: "token-1" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "sync exploded",
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(sendBillLightweight("u1", {
      type: "expense",
      payee: "Power Co",
      amount: 12.34,
      due_date: "2026-05-20",
      account_id: "acct-1",
      notes: "Statement ready",
    }, {
      dbClient: settingsDbClient(),
      now: new Date("2026-05-15T12:00:00.000Z"),
    })).rejects.toMatchObject({
      localWriteApplied: true,
      code: "ACTUAL_LIGHTWEIGHT_SYNC_FAILED",
    });

    // Recoverable state: the write and its CRDT messages are committed
    // locally, and lastSyncedTimestamp was not advanced, so the next
    // successful sync re-pushes them.
    const client = createClient({ url: `file:${path.join(budgetDir, "db.sqlite")}` });
    const txns = await client.execute("SELECT amount FROM transactions");
    const messages = await client.execute("SELECT dataset FROM messages_crdt");
    await client.close();
    expect(txns.rows).toEqual([expect.objectContaining({ amount: -1234 })]);
    expect(messages.rows.length).toBeGreaterThan(0);
    const metadata = JSON.parse(await (await import("fs/promises")).readFile(path.join(budgetDir, "metadata.json"), "utf8")) as { lastSyncedTimestamp?: string };
    expect(metadata.lastSyncedTimestamp).toBeUndefined();
  });

  it("does not flag pre-write failures as locally applied", async () => {
    await createBudgetDb();

    const err = await sendBillLightweight("u1", {
      type: "expense",
      payee: "Power Co",
      amount: 12.34,
      due_date: "2026-05-20",
      account_id: "acct-1",
      category_id: "missing-category",
    }, {
      dbClient: settingsDbClient(),
      now: new Date("2026-05-15T12:00:00.000Z"),
    }).then(() => null, (e) => e);

    expect(err).toMatchObject({ status: 400 });
    expect((err as { localWriteApplied?: boolean }).localWriteApplied).toBeUndefined();
  });
});
