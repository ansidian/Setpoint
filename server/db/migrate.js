import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import db from "./connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, "migrations");

async function ensureMigrationsTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getExecutedMigrations() {
  const result = await db.execute("SELECT name FROM migrations ORDER BY name");
  return new Set(result.rows.map((row) => row.name));
}

async function runMigration(name, sql, { dbClient = db } = {}) {
  console.log(`Running migration: ${name}`);
  // Apply the migration body AND its ledger row as ONE atomic write transaction.
  // The top-level executeMultiple is explicitly non-transactional, so a statement
  // failure (or process kill) partway would otherwise leave the schema
  // half-applied with no ledger row — the next boot would re-run the file against
  // an already-mutated schema, hit "duplicate column" / "no such table" on
  // ALTER/DROP/RENAME migrations, and exit(1) on every boot.
  //
  // The per-file transaction makes every migration body atomic, covering both the
  // "014 DROP+RENAME is not transactional" and "bare non-idempotent ALTER ADD
  // COLUMN replay is fatal" failure modes at the runner level. If the individual
  // .sql files are also hardened (splitting 014, guarding ALTERs), treat those as
  // defense-in-depth — do NOT remove this transaction wrapper.
  const tx = await dbClient.transaction("write");
  try {
    // Transaction-level executeMultiple runs inside the open transaction and
    // delegates statement splitting to libsql (comments, string literals, trigger
    // bodies) — unlike a naive sql.split(";").
    await tx.executeMultiple(sql);
    await tx.execute({
      sql: "INSERT INTO migrations (name) VALUES (?)",
      args: [name],
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
  console.log(`Completed migration: ${name}`);
}

export const __testing__ = { runMigration, ensureMigrationsTable };

export async function migrate() {
  console.log("Starting EA database migrations...");
  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();

  let migrationFiles;
  try {
    migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("No migrations directory found, skipping.");
      return;
    }
    throw err;
  }

  let ranCount = 0;
  for (const file of migrationFiles) {
    if (!executed.has(file)) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      await runMigration(file, sql);
      ranCount++;
    }
  }

  console.log(ranCount === 0 ? "No new migrations." : `Ran ${ranCount} migration(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
