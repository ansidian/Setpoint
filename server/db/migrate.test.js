import { createClient } from "@libsql/client";
import { mkdtemp } from "fs/promises";
import { removeTempDir } from "../test-utils/temp-dir.js";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// These suites guard the boot-loop bug: runMigration must apply a migration's
// body and its ledger row atomically, so a partial failure leaves NO schema
// change and NO ledger row and the next boot can cleanly re-run it. The suites
// exercise the API __testing__.runMigration(name, sql, { dbClient }).
//
// The runner imports the db singleton; stub it so importing migrate.js doesn't
// open a real connection. Every test passes its own dbClient explicitly. A real
// file-backed libSQL DB (not :memory:) is required so the runner's transaction
// connection shares the same database — :memory: gives each connection a
// distinct database and would not exercise commit/rollback visibility.
vi.mock("./connection.js", () => ({ default: {} }));

const { __testing__ } = await import("./migrate.js");
const { runMigration } = __testing__;

describe("runMigration atomicity (P1-8)", () => {
  let db = null;
  let dir = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
    if (dir) {
      await removeTempDir(dir);
      dir = null;
    }
  });

  async function freshClient() {
    dir = await mkdtemp(path.join(os.tmpdir(), "setpoint-migrate-"));
    return createClient({ url: `file:${path.join(dir, "test.db")}` });
  }

  async function ensureLedger(client) {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  it("rolls back a partially-failing migration and records no ledger row", async () => {
    db = await freshClient();
    await ensureLedger(db);

    // First statement is valid (creates table t), second is invalid (unknown
    // function) — mirrors a multi-statement migration that dies partway.
    await expect(
      runMigration(
        "bad_migration.sql",
        "CREATE TABLE t (id INTEGER);\nSELECT no_such_fn();",
        { dbClient: db },
      ),
    ).rejects.toThrow();

    const table = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='t'",
    );
    expect(table.rows).toEqual([]); // partial DDL must be rolled back

    const ledger = await db.execute("SELECT name FROM migrations");
    expect(ledger.rows).toEqual([]); // no ledger row for a failed migration
  });

  it("commits both the schema and the ledger row on success", async () => {
    db = await freshClient();
    await ensureLedger(db);

    await runMigration(
      "good_migration.sql",
      "CREATE TABLE t (id INTEGER NOT NULL);",
      { dbClient: db },
    );

    const table = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='t'",
    );
    expect(table.rows.map((row) => row.name)).toEqual(["t"]);

    const ledger = await db.execute("SELECT name FROM migrations");
    expect(ledger.rows.map((row) => row.name)).toEqual(["good_migration.sql"]);
  });
});

describe("runMigration ALTER replay (P2-21/22)", () => {
  let tempDir = null;

  async function seedDb() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ea-migrate-"));
    const db = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
    await db.executeMultiple(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, executed_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE widget (id INTEGER);
    `);
    return db;
  }

  afterEach(async () => {
    if (tempDir) await removeTempDir(tempDir);
    tempDir = null;
  });

  it("rolls back the schema change AND the ledger when a later statement fails", async () => {
    const db = await seedDb();
    // Adds a column, then a statement that fails — the whole migration must roll back.
    const sql = "ALTER TABLE widget ADD COLUMN extra TEXT;\nINSERT INTO missing_table VALUES (1);";

    await expect(runMigration("099_bad.sql", sql, { dbClient: db })).rejects.toThrow();

    const cols = await db.execute("PRAGMA table_info(widget)");
    expect(cols.rows.some((r) => r.name === "extra")).toBe(false); // schema rolled back
    const recorded = await db.execute("SELECT name FROM migrations");
    expect(recorded.rows.length).toBe(0); // not recorded, so the next boot retries cleanly
    await db.close();
  });

  it("applies and records a migration on success", async () => {
    const db = await seedDb();
    await runMigration("100_good.sql", "ALTER TABLE widget ADD COLUMN extra TEXT;", { dbClient: db });

    const cols = await db.execute("PRAGMA table_info(widget)");
    expect(cols.rows.some((r) => r.name === "extra")).toBe(true);
    const recorded = await db.execute("SELECT name FROM migrations");
    expect(recorded.rows.map((r) => r.name)).toEqual(["100_good.sql"]);
    await db.close();
  });
});
