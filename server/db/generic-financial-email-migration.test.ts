import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

describe("generic financial email import migration", () => {
  it("preserves legacy items and admits one generic row per stable imported identity", async () => {
    const db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of [
      "001_ea_tables.sql",
      "030_owner_bootstrap.sql",
      "041_email_transaction_imports.sql",
      "042_transaction_import_item_subject.sql",
      "053_transaction_import_financial_plans.sql",
    ]) {
      await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }
    await db.execute(`INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at)
                      VALUES (1, 'owner-1', 'hash', 1)`);
    await db.execute(`INSERT INTO ea_transaction_import_runs
                        (id, user_id, trigger, options_key, gmail_account_ids_json, sources_json,
                         status, cursor_json, created_at, updated_at)
                      VALUES
                        ('legacy-run', 'owner-1', 'arrival', 'legacy', '[]', '["amazon"]', 'completed', '{}', 1, 1),
                        ('generic-run', 'owner-1', 'arrival', 'generic', '[]', '["generic"]', 'completed', '{}', 1, 1)`);
    await db.execute(`INSERT INTO ea_transaction_import_items
                        (id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid,
                         candidate_key, source, parser_version, imported_id, transaction_date,
                         amount_cents, currency, payee, automation_mode, automatic_safe,
                         status, created_at, updated_at, email_subject, financial_email_plan_json)
                      VALUES
                        ('legacy-item', 'legacy-run', 'owner-1', 'gmail-1', 'message-1', 'uid-1',
                         'amazon-order-1', 'amazon', 'amazon-v1', 'amazon-order-1', '2026-09-01',
                         -1200, 'USD', 'Amazon', 'observe', 0, 'needs_review', 1, 1, 'Order', '{"version":1}')`);

    await db.executeMultiple(readFileSync(join(migrationsDir, "055_generic_financial_email_imports.sql"), "utf8"));

    const legacy = await db.execute("SELECT source, imported_id, email_subject, financial_email_plan_json FROM ea_transaction_import_items WHERE id = 'legacy-item'");
    expect(legacy.rows[0]).toEqual({
      source: "amazon",
      imported_id: "amazon-order-1",
      email_subject: "Order",
      financial_email_plan_json: "{\"version\":1}",
    });
    await db.execute(`INSERT INTO ea_transaction_import_items
                        (id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid,
                         candidate_key, source, parser_version, imported_id, transaction_date,
                         amount_cents, currency, payee, automation_mode, automatic_safe,
                         status, created_at, updated_at)
                      VALUES
                        ('generic-item', 'generic-run', 'owner-1', 'gmail-1', 'message-2', 'uid-2',
                         'financial-email:v1:stable', 'generic', 'financial-email-plan-v1',
                         'financial-email:v1:stable', '2026-09-01', -1200, 'USD', 'Market',
                         'observe', 0, 'queued', 1, 1)`);
    await expect(db.execute(`INSERT INTO ea_transaction_import_items
                              (id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid,
                               candidate_key, source, parser_version, imported_id, transaction_date,
                               amount_cents, currency, payee, automation_mode, automatic_safe,
                               status, created_at, updated_at)
                            VALUES
                              ('generic-duplicate', 'generic-run', 'owner-1', 'gmail-1', 'message-3', 'uid-3',
                               'financial-email:v1:stable', 'generic', 'financial-email-plan-v1',
                               'financial-email:v1:stable', '2026-09-01', -1200, 'USD', 'Market',
                               'observe', 0, 'queued', 1, 1)`)).rejects.toThrow();
    const beforeAutomation = await db.execute("SELECT * FROM ea_transaction_import_items ORDER BY id");
    await db.executeMultiple(readFileSync(join(migrationsDir, "056_generic_financial_email_automation.sql"), "utf8"));
    expect((await db.execute("SELECT * FROM ea_transaction_import_items ORDER BY id")).rows).toEqual(beforeAutomation.rows);
    await expect(db.execute("UPDATE ea_transaction_import_items SET automatic_safe = 1 WHERE id = 'generic-item'")).rejects.toThrow();
    await db.execute(`UPDATE ea_transaction_import_items
                      SET external_id = imported_id, actual_account_id = 'checking',
                          financial_email_plan_json = '{"version":1}',
                          automation_mode = 'automatic', automatic_safe = 1
                      WHERE id = 'generic-item'`);
    expect((await db.execute("SELECT automatic_safe, automation_mode FROM ea_transaction_import_items WHERE id = 'generic-item'")).rows[0])
      .toEqual({ automatic_safe: 1, automation_mode: "automatic" });
    await expect(db.execute("UPDATE ea_transaction_import_items SET amount_cents = 1200 WHERE id = 'generic-item'")).rejects.toThrow();
    await expect(db.execute("UPDATE ea_transaction_import_items SET currency = 'EUR' WHERE id = 'generic-item'")).rejects.toThrow();
    const beforeIncomeAutomation = await db.execute("SELECT * FROM ea_transaction_import_items ORDER BY id");
    await db.executeMultiple(readFileSync(join(migrationsDir, "058_generic_financial_email_income_automation.sql"), "utf8"));
    expect((await db.execute("SELECT * FROM ea_transaction_import_items ORDER BY id")).rows).toEqual(beforeIncomeAutomation.rows);
    await db.execute(`INSERT INTO ea_transaction_import_items
                        (id, run_id, user_id, gmail_account_id, gmail_message_id, email_uid,
                         candidate_key, source, parser_version, external_id, imported_id, transaction_date,
                         amount_cents, currency, payee, actual_account_id, automation_mode, automatic_safe,
                         status, created_at, updated_at, financial_email_plan_json)
                      VALUES
                        ('income-item', 'generic-run', 'owner-1', 'gmail-1', 'message-income', 'uid-income',
                         'financial-email:v1:income', 'generic', 'financial-email-semantics-v2', 'reward-1',
                         'financial-email:v1:income', '2026-09-03', 2225, 'USD', 'Cashback', 'savings',
                         'automatic', 1, 'ready', 1, 1,
                         '{"automation":{"operationClass":"income"}}')`);
    await expect(db.execute("UPDATE ea_transaction_import_items SET amount_cents = -2225 WHERE id = 'income-item'"))
      .rejects.toThrow();
    expect((await db.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
    db.close();
  });
});
