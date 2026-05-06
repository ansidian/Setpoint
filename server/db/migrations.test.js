import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

async function applyMigrations(db, files) {
  for (const file of files) {
    await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

describe("database migrations", () => {
  let db = null;

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("indexes email read-state searches by user and newest date", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "004_email_read_state_search_index.sql",
    ]);

    const columns = await db.execute(
      "PRAGMA index_info('idx_email_index_user_read_date')",
    );

    expect(columns.rows.map((row) => row.name)).toEqual([
      "user_id",
      "read",
      "email_date",
    ]);
  });
});
