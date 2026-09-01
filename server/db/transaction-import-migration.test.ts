import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

describe("email transaction import migration", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of ["001_ea_tables.sql", "030_owner_bootstrap.sql", "041_email_transaction_imports.sql", "042_transaction_import_item_subject.sql", "053_transaction_import_financial_plans.sql"]) {
      await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }
    await db.execute(`INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at)
                      VALUES (1, 'owner-1', 'hash', 1)`);
  });

  afterEach(() => db.close());

  it("creates constrained mappings and resumable run indexes", async () => {
    const columns = await db.execute("PRAGMA table_info('ea_transaction_import_mappings')");
    expect(columns.rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      "user_id", "source", "mode", "actual_account_id", "actual_category_id",
    ]));
    await expect(db.execute(`INSERT INTO ea_transaction_import_mappings
      (user_id, source, mode, created_at, updated_at) VALUES ('owner-1', 'venmo', 'automatic', 1, 1)`)).rejects.toThrow();

    const insertRun = (id: string) => db.execute({
      sql: `INSERT INTO ea_transaction_import_runs
        (id, user_id, trigger, options_key, gmail_account_ids_json, sources_json,
         start_date, end_date, cursor_json, created_at, updated_at)
        VALUES (?, 'owner-1', 'historical_scan', 'same-scan', '["gmail-1"]', '["amazon"]',
                '2026-01-01', '2026-02-01', '{"pageToken":"next"}', 1, 1)`,
      args: [id],
    });
    await insertRun("run-1");
    await expect(insertRun("run-2")).rejects.toThrow();
    const claimIndex = await db.execute("PRAGMA index_info('idx_transaction_import_runs_claim')");
    expect(claimIndex.rows.map((row) => row.name)).toEqual(["status", "next_attempt_at", "updated_at"]);
  });

  it("enforces candidate identity, automatic safety, and composite owner isolation", async () => {
    await db.execute(`INSERT INTO ea_transaction_import_runs
      (id, user_id, trigger, options_key, start_date, end_date, created_at, updated_at)
      VALUES ('run-1', 'owner-1', 'arrival', 'arrival-1', NULL, NULL, 1, 1)`);
    const insertItem = (id: string, userId: string, importedId: string | null, automaticSafe: number) => db.execute({
      sql: `INSERT INTO ea_transaction_import_items
        (id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid, candidate_key,
         source, parser_version, external_id, imported_id, transaction_date, amount_cents,
         currency, payee, automation_mode, automatic_safe, created_at, updated_at)
        VALUES (?, 'run-1', ?, 'gmail-1', 'message-1', 'uid-1', 'candidate-1',
                'amazon', 'amazon-v1', ?, ?, '2026-01-15', -2599,
                'USD', 'Amazon', 'automatic', ?, 1, 1)`,
      args: [id, userId, importedId ? "external-1" : null, importedId, automaticSafe],
    });
    await insertItem("item-1", "owner-1", "amazon-external-1", 1);
    await expect(insertItem("item-duplicate", "owner-1", "amazon-external-1", 1)).rejects.toThrow();
    await expect(db.execute(`UPDATE ea_transaction_import_items SET imported_id = NULL WHERE id = 'item-1'`)).rejects.toThrow();
    await expect(insertItem("item-cross-owner", "owner-other", null, 0)).rejects.toThrow();

    const itemForeignKeys = await db.execute("PRAGMA foreign_key_list('ea_transaction_import_items')");
    const runOwnerForeignKey = itemForeignKeys.rows.filter((row) => row.table === "ea_transaction_import_runs");
    expect(runOwnerForeignKey.map((row) => [row.from, row.to])).toEqual(expect.arrayContaining([
      ["run_id", "id"], ["user_id", "user_id"],
    ]));
    const itemColumns = await db.execute("PRAGMA table_info('ea_transaction_import_items')");
    expect(itemColumns.rows.some((row) => row.name === "email_subject" && Number(row.notnull) === 1)).toBe(true);
    expect(itemColumns.rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      "financial_email_plan_json", "financial_plan_shadow_json",
    ]));
  });
});
