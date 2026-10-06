import { createClient, type Client } from "@libsql/client";
import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");
const REMOVAL = "085_remove_financial_flows.sql";

async function applyMigrations(db: Client, files: readonly string[]) {
  for (const file of files) await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

async function indexEmail(db: Client, uid: string) {
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO ea_email_index (uid, user_id, account_id, account_label, account_email, email_date, email_date_utc, indexed_at)
          VALUES (?, 'owner', 'gmail-a', 'Work', 'owner@example.test', ?, ?, ?)`,
    args: [uid, now, now, now],
  });
}

describe("financial flow removal migration", () => {
  let db: Client | null = null;
  afterEach(() => { db?.close(); db = null; });

  it("drops financial state while preserving the read-only Actual data, settings and email indexing", async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    await applyMigrations(db, files.filter((file) => file < REMOVAL));
    await db.execute("UPDATE ea_financial_workflow_state SET cutover_at = '2000-01-01T00:00:00.000Z'");
    await db.execute(`INSERT INTO ea_settings (user_id, bill_extract_provider, bill_extract_model, actual_budget_sync_id)
                      VALUES ('owner', 'openai', 'gpt-5.4-mini', 'budget')`);
    await db.execute(`INSERT INTO ea_payment_organizations (user_id, budget_id, revision, groups_json, updated_at)
                      VALUES ('owner', 'budget', 2, '[]', 'now')`);
    await db.execute(`INSERT INTO ea_current_data_cache (user_id, cache_key, payload_json) VALUES ('owner', 'bills_current', '{}'), ('owner', 'weather_current', '{}')`);
    await indexEmail(db, "before-removal");
    expect((await db.execute("SELECT email_uid FROM ea_financial_documents")).rows).toEqual([{ email_uid: "before-removal" }]);

    await applyMigrations(db, [REMOVAL]);

    const leftovers = await db.execute(`SELECT name FROM sqlite_master
      WHERE name LIKE '%financ%' OR name LIKE '%transaction_import%' OR name = 'ea_api_tokens'`);
    expect(leftovers.rows).toEqual([]);
    expect((await db.execute("SELECT triage_fast_provider, triage_fast_model, actual_budget_sync_id, actual_budget_encryption_password_encrypted FROM ea_settings")).rows)
      .toEqual([{ triage_fast_provider: "openai", triage_fast_model: "gpt-5.4-mini", actual_budget_sync_id: "budget", actual_budget_encryption_password_encrypted: null }]);
    expect((await db.execute("SELECT revision FROM ea_payment_organizations")).rows).toEqual([{ revision: 2 }]);
    expect((await db.execute("SELECT cache_key FROM ea_current_data_cache")).rows).toEqual([{ cache_key: "weather_current" }]);
    await indexEmail(db, "after-removal");
    expect((await db.execute("SELECT count(*) AS count FROM ea_email_index")).rows).toEqual([{ count: 2 }]);
    expect((await db.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  });
});
