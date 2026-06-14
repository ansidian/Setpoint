import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigration } from "./migrate.js";

// Guards the boot-loop bug (P1-8): runMigration must apply a migration's body
// and its ledger row atomically. A migration that fails partway must leave NO
// schema change and NO ledger row, so the next boot can cleanly re-run it
// instead of hitting "duplicate column" / "no such table" forever.
//
// Uses a temp file-backed libSQL DB (not `file::memory:`): an in-memory DB does
// not share state between the client's default connection and an interactive
// transaction's connection, so a file DB is required to exercise commit/rollback
// visibility the way production (a real file / Turso) does.
describe("runMigration atomicity", () => {
  let db = null;
  let dir = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  function freshClient() {
    dir = mkdtempSync(join(tmpdir(), "setpoint-migrate-"));
    return createClient({ url: `file:${join(dir, "test.db")}` });
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
    db = freshClient();
    await ensureLedger(db);

    // First statement is valid (creates table t), second is invalid (unknown
    // function) — mirrors a multi-statement migration that dies partway.
    await expect(
      runMigration(
        db,
        "bad_migration.sql",
        "CREATE TABLE t (id INTEGER);\nSELECT no_such_fn();",
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
    db = freshClient();
    await ensureLedger(db);

    await runMigration(
      db,
      "good_migration.sql",
      "CREATE TABLE t (id INTEGER NOT NULL);",
    );

    const table = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='t'",
    );
    expect(table.rows.map((row) => row.name)).toEqual(["t"]);

    const ledger = await db.execute("SELECT name FROM migrations");
    expect(ledger.rows.map((row) => row.name)).toEqual(["good_migration.sql"]);
  });
});
