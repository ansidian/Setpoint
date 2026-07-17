import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

async function applyMigrations(db: Client, files: readonly string[]) {
  for (const file of files) {
    await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

describe("database migrations", () => {
  let db: Client | null = null;

  afterEach(async () => {
    db?.close();
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

  it("adds rebuildable email search embedding storage", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "004_email_read_state_search_index.sql",
      "005_email_search_embeddings.sql",
    ]);

    const columns = await db.execute(
      "PRAGMA table_info('ea_email_search_embeddings')",
    );
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));

    expect(columnByName.get("uid")!.pk).toBe(1);
    expect(columnByName.get("document_text")!.notnull).toBe(1);
    expect(columnByName.get("source_hash")!.notnull).toBe(1);
    expect(columnByName.get("document_version")!.notnull).toBe(1);
    expect(columnByName.get("embedding_model")!.notnull).toBe(1);
    expect(columnByName.get("embedding_dimensions")!.notnull).toBe(1);
    expect(columnByName.get("embedding")!.type).toBe("F32_BLOB(1536)");
  });

  it("adds content-free email search embedding worker state", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "004_email_read_state_search_index.sql",
      "005_email_search_embeddings.sql",
      "006_email_search_embedding_state.sql",
    ]);

    const columns = await db.execute(
      "PRAGMA table_info('ea_email_search_embedding_state')",
    );
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));

    expect(columnByName.get("user_id")!.pk).toBe(1);
    expect(columnByName.get("status")!.notnull).toBe(1);
    expect(columnByName.get("fresh_embeddings")!.notnull).toBe(1);
    expect(columnByName.get("stale_embeddings")!.notnull).toBe(1);
    expect(columnByName.get("missing_embeddings")!.notnull).toBe(1);
    expect(columnByName.has("document_text")).toBe(false);
  });

  it("adds content-free email search AI usage analytics", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "004_email_read_state_search_index.sql",
      "005_email_search_embeddings.sql",
      "006_email_search_embedding_state.sql",
      "007_email_search_ai_usage.sql",
    ]);

    const columns = await db.execute(
      "PRAGMA table_info('ea_email_search_ai_usage')",
    );
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));

    expect(columnByName.get("event_type")!.notnull).toBe(1);
    expect(columnByName.get("model")!.notnull).toBe(1);
    expect(columnByName.get("input_tokens")!.notnull).toBe(1);
    expect(columnByName.get("estimated")!.notnull).toBe(1);
    expect(columnByName.get("metadata_json")!.notnull).toBe(1);
    expect(columnByName.has("query_text")).toBe(false);
    expect(columnByName.has("answer_text")).toBe(false);
  });

  it("adds Bill Pay mapping settings JSON storage", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "008_bill_pay_mappings.sql",
    ]);

    const columns = await db.execute("PRAGMA table_info('ea_settings')");
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));

    expect(columnByName.get("bill_pay_mappings_json")!.type).toBe("TEXT");
    expect(columnByName.get("bill_pay_mappings_json")!.dflt_value).toBe("NULL");
  });

  it("adds Actual metadata projection storage", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "009_actual_metadata_mirror.sql",
    ]);

    const columns = await db.execute("PRAGMA table_info('ea_actual_metadata_mirror')");
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));

    expect(columnByName.get("user_id")!.pk).toBe(1);
    expect(columnByName.get("accounts_json")!.notnull).toBe(1);
    expect(columnByName.get("payees_json")!.notnull).toBe(1);
    expect(columnByName.get("categories_json")!.notnull).toBe(1);
    expect(columnByName.get("schedules_json")!.notnull).toBe(1);
    expect(columnByName.get("recent_transactions_json")!.notnull).toBe(1);
  });

  it("adds encrypted Discord settings and polymorphic reminder storage", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "010_discord_reminders.sql",
    ]);

    const settingsColumns = await db.execute("PRAGMA table_info('ea_settings')");
    const settingsByName = new Map(settingsColumns.rows.map((row) => [row.name, row]));
    expect(settingsByName.get("discord_webhook_url_encrypted")!.type).toBe("TEXT");
    expect(settingsByName.get("discord_user_id")!.type).toBe("TEXT");

    const reminderColumns = await db.execute("PRAGMA table_info('ea_reminders')");
    const reminderByName = new Map(reminderColumns.rows.map((row) => [row.name, row]));
    expect(reminderByName.get("id")!.pk).toBe(1);
    expect(reminderByName.get("user_id")!.notnull).toBe(1);
    expect(reminderByName.get("source_type")!.notnull).toBe(1);
    expect(reminderByName.get("source_item_id")!.notnull).toBe(1);
    expect(reminderByName.get("anchor_kind")!.notnull).toBe(1);
    expect(reminderByName.get("offset_minutes")!.notnull).toBe(1);
    expect(reminderByName.get("remind_at")!.notnull).toBe(1);
    expect(reminderByName.get("retry_count")!.dflt_value).toBe("0");

    const dueIndex = await db.execute("PRAGMA index_info('idx_ea_reminders_due')");
    expect(dueIndex.rows.map((row) => row.name)).toEqual([
      "status",
      "remind_at",
      "retry_after",
    ]);
  });

  it("adds Calendar Search Mirror state and occurrence storage", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "011_calendar_search_mirror.sql",
    ]);

    const stateColumns = await db.execute("PRAGMA table_info('ea_calendar_search_mirror_state')");
    const stateByName = new Map(stateColumns.rows.map((row) => [row.name, row]));
    expect(stateByName.get("user_id")!.pk).toBe(1);
    expect(stateByName.get("account_id")!.pk).toBe(2);
    expect(stateByName.get("calendar_id")!.pk).toBe(3);
    expect(stateByName.get("window_start")!.notnull).toBe(1);
    expect(stateByName.get("window_end")!.notnull).toBe(1);
    expect(stateByName.get("sync_token")!.type).toBe("TEXT");
    expect(stateByName.get("dirty_since")!.type).toBe("TEXT");
    expect(stateByName.get("failed_check_count")!.dflt_value).toBe("0");

    const occurrenceColumns = await db.execute("PRAGMA table_info('ea_calendar_search_occurrences')");
    const occurrenceByName = new Map(occurrenceColumns.rows.map((row) => [row.name, row]));
    expect(occurrenceByName.get("user_id")!.pk).toBe(1);
    expect(occurrenceByName.get("account_id")!.pk).toBe(2);
    expect(occurrenceByName.get("calendar_id")!.pk).toBe(3);
    expect(occurrenceByName.get("event_id")!.pk).toBe(4);
    expect(occurrenceByName.get("original_start_key")!.pk).toBe(5);
    expect(occurrenceByName.get("searchable_text")!.notnull).toBe(1);
    expect(occurrenceByName.get("start_ms")!.notnull).toBe(1);
    expect(occurrenceByName.get("status")!.dflt_value).toBe("'confirmed'");

    const rangeIndex = await db.execute("PRAGMA index_info('idx_calendar_search_occurrences_range')");
    expect(rangeIndex.rows.map((row) => row.name)).toEqual([
      "user_id",
      "start_ms",
      "status",
    ]);
  });

  it("adds passkey auth foundation storage", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "012_passkey_auth.sql",
    ]);

    const passkeyColumns = await db.execute("PRAGMA table_info('ea_passkey_credentials')");
    const passkeyByName = new Map(passkeyColumns.rows.map((row) => [row.name, row]));
    expect(passkeyByName.get("credential_id")!.notnull).toBe(1);
    expect(passkeyByName.get("user_id")!.notnull).toBe(1);
    expect(passkeyByName.get("label")!.notnull).toBe(1);
    expect(passkeyByName.get("public_key")!.notnull).toBe(1);
    expect(passkeyByName.get("sign_count")!.notnull).toBe(1);

    const pendingColumns = await db.execute("PRAGMA table_info('ea_pending_auth')");
    const pendingByName = new Map(pendingColumns.rows.map((row) => [row.name, row]));
    expect(pendingByName.get("token_hash")!.pk).toBe(1);
    expect(pendingByName.get("user_id")!.notnull).toBe(1);
    expect(pendingByName.get("expires_at")!.notnull).toBe(1);

    const challengeColumns = await db.execute("PRAGMA table_info('ea_webauthn_challenges')");
    const challengeByName = new Map(challengeColumns.rows.map((row) => [row.name, row]));
    expect(challengeByName.get("challenge_hash")!.pk).toBe(1);
    expect(challengeByName.get("challenge_type")!.notnull).toBe(1);
    expect(challengeByName.get("expires_at")!.notnull).toBe(1);

    const pendingIndex = await db.execute("PRAGMA index_info('idx_ea_pending_auth_user_expires')");
    expect(pendingIndex.rows.map((row) => row.name)).toEqual(["user_id", "expires_at"]);
  });

  it("adds explicit auth mode, recent-auth state, and hashed recovery storage", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "030_owner_bootstrap.sql",
      "031_auth_recovery.sql",
    ]);

    const ownerColumns = await db.execute("PRAGMA table_info('ea_owner')");
    const ownerByName = new Map(ownerColumns.rows.map((row) => [row.name, row]));
    expect(ownerByName.get("auth_mode")!.notnull).toBe(1);
    expect(ownerByName.get("auth_mode")!.dflt_value).toBe("'password_or_passkey'");

    const sessionColumns = await db.execute("PRAGMA table_info('ea_sessions')");
    const sessionByName = new Map(sessionColumns.rows.map((row) => [row.name, row]));
    expect(sessionByName.get("authenticated_at")!.notnull).toBe(1);
    expect(sessionByName.get("authenticated_at")!.dflt_value).toBe("0");

    const recoveryColumns = await db.execute("PRAGMA table_info('ea_owner_recovery_codes')");
    const recoveryByName = new Map(recoveryColumns.rows.map((row) => [row.name, row]));
    expect(recoveryByName.get("code_hash")!.notnull).toBe(1);
    expect(recoveryByName.get("used_at")!.type).toBe("INTEGER");
  });

  it("adds normalized email date storage for temporal search filters", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "004_email_read_state_search_index.sql",
      "013_email_index_normalized_date.sql",
    ]);

    const columns = await db.execute("PRAGMA table_info('ea_email_index')");
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));
    expect(columnByName.get("email_date_utc")!.type).toBe("TEXT");
    expect(columnByName.get("email_date_utc")!.notnull).toBe(1);

    const dateIndex = await db.execute("PRAGMA index_info('idx_email_index_user_date_utc')");
    expect(dateIndex.rows.map((row) => row.name)).toEqual(["user_id", "email_date_utc"]);

    const readDateIndex = await db.execute("PRAGMA index_info('idx_email_index_user_read_date_utc')");
    expect(readDateIndex.rows.map((row) => row.name)).toEqual(["user_id", "read", "email_date_utc"]);
  });

  it("stores completed deadline history as required dated occurrences", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "014_completed_deadline_occurrences.sql",
    ]);

    const columns = await db.execute("PRAGMA table_info('ea_completed_tasks')");
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));
    expect(columnByName.get("user_id")!.pk).toBe(1);
    expect(columnByName.get("todoist_id")!.pk).toBe(2);
    expect(columnByName.get("due_date")!.pk).toBe(3);
    expect(columnByName.get("due_date")!.notnull).toBe(1);

    await db.execute({
      sql: `INSERT INTO ea_completed_tasks (user_id, todoist_id, due_date, snapshot_json)
            VALUES (?, ?, ?, ?)`,
      args: ["u1", "td-rec", "2026-05-12", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO ea_completed_tasks (user_id, todoist_id, due_date, snapshot_json)
            VALUES (?, ?, ?, ?)`,
      args: ["u1", "td-rec", "2026-05-14", "{}"],
    });

    const rows = await db.execute("SELECT todoist_id, due_date FROM ea_completed_tasks ORDER BY due_date");
    expect(rows.rows).toEqual([
      expect.objectContaining({ todoist_id: "td-rec", due_date: "2026-05-12" }),
      expect.objectContaining({ todoist_id: "td-rec", due_date: "2026-05-14" }),
    ]);
  });

  it("drops legacy undated completed-task rows when migrating completed deadline occurrences", async () => {
    db = createClient({ url: "file::memory:" });
    await db.executeMultiple(`
      CREATE TABLE ea_completed_tasks (
        user_id TEXT NOT NULL,
        todoist_id TEXT NOT NULL,
        completed_at TEXT DEFAULT (datetime('now')),
        due_date TEXT,
        snapshot_json TEXT,
        PRIMARY KEY (user_id, todoist_id)
      );
    `);
    await db.execute({
      sql: `INSERT INTO ea_completed_tasks (user_id, todoist_id, completed_at, due_date, snapshot_json)
            VALUES (?, ?, ?, ?, ?)`,
      args: ["u1", "legacy-undated", "2026-05-12T12:00:00.000Z", null, "{}"],
    });
    await db.execute({
      sql: `INSERT INTO ea_completed_tasks (user_id, todoist_id, completed_at, due_date, snapshot_json)
            VALUES (?, ?, ?, ?, ?)`,
      args: ["u1", "dated", "2026-05-12T12:00:00.000Z", "2026-05-12", "{}"],
    });

    await applyMigrations(db, ["014_completed_deadline_occurrences.sql"]);

    const rows = await db.execute("SELECT todoist_id, due_date FROM ea_completed_tasks ORDER BY todoist_id");
    expect(rows.rows).toEqual([
      expect.objectContaining({ todoist_id: "dated", due_date: "2026-05-12" }),
    ]);
  });

  it("adds the triage last_decision_reason observability column", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "015_triage_last_decision_reason.sql",
    ]);

    const columns = await db.execute("PRAGMA table_info('ea_email_triage')");
    const column = columns.rows.find((row) => row.name === "last_decision_reason")!;

    expect(column).toBeDefined();
    expect(column.type).toBe("TEXT");
    expect(column.notnull).toBe(0);
  });

  it("rebuilds a legacy briefing-era pinned table to the canonical pin-overlay shape", async () => {
    db = createClient({ url: "file::memory:" });
    // Prod still carries the April-2026 briefing-era ea_pinned_emails (old
    // 020_pinned_emails.sql + old 022_pinned_emails_snapshot.sql ALTER): no
    // account_id, nullable pinned_at. 022's CREATE TABLE IF NOT EXISTS no-ops
    // against it, so 023 must rebuild the table to the canonical shape.
    await db.executeMultiple(`
      CREATE TABLE ea_pinned_emails (
        user_id TEXT NOT NULL,
        email_id TEXT NOT NULL,
        pinned_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, email_id)
      );
      ALTER TABLE ea_pinned_emails ADD COLUMN email_snapshot TEXT;
    `);
    await db.execute({
      sql: "INSERT INTO ea_pinned_emails (user_id, email_id) VALUES (?, ?)",
      args: ["u1", "stale-april-pin"],
    });

    await applyMigrations(db, [
      "022_pinned_emails.sql",
      "023_pinned_emails_rebuild.sql",
    ]);

    const columns = await db.execute("PRAGMA table_info('ea_pinned_emails')");
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));
    expect(columnByName.get("user_id")!.pk).toBe(1);
    expect(columnByName.get("email_id")!.pk).toBe(2);
    expect(columnByName.get("account_id")!.type).toBe("TEXT");
    expect(columnByName.get("pinned_at")!.notnull).toBe(1);
    expect(columnByName.get("email_snapshot")!.type).toBe("TEXT");

    // Retired briefing-era pins are discarded, not resurrected into the new UI.
    const rows = await db.execute("SELECT * FROM ea_pinned_emails");
    expect(rows.rows).toEqual([]);

    const index = await db.execute("PRAGMA index_info('idx_pinned_emails_user')");
    expect(index.rows.map((row) => row.name)).toEqual(["user_id", "pinned_at"]);
  });

  it("retires dead pre-rebaseline ledger rows so future migration names cannot collide", async () => {
    db = createClient({ url: "file::memory:" });
    // The 2026-05-05 migrations rebaseline (ce116483) deleted the old file set,
    // but long-lived DBs still carry their ledger rows. Any future file that
    // reuses one of those names would be silently skipped by migrate(). 024
    // renames the dead rows out of the collision namespace.
    await db.executeMultiple(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const seeded = [
      "002_account_calendar_flag.sql", // first dead name
      "020_pinned_emails.sql", // the name-reuse that caused the 2026-07-01 outage
      "023_snoozed_emails.sql", // collides with the natural next-number namespace
      "044_legacy_briefing_cleanup.sql", // last dead name
      "001_ea_tables.sql", // also a CURRENT file — must stay recorded as executed
      "022_pinned_emails.sql", // current-era row — untouched
    ];
    for (const name of seeded) {
      await db.execute({
        sql: "INSERT INTO migrations (name) VALUES (?)",
        args: [name],
      });
    }

    await applyMigrations(db, ["024_retire_legacy_ledger_rows.sql"]);

    const rows = await db.execute("SELECT name FROM migrations ORDER BY name");
    expect(rows.rows.map((row) => row.name)).toEqual([
      "001_ea_tables.sql",
      "022_pinned_emails.sql",
      "legacy/002_account_calendar_flag.sql",
      "legacy/020_pinned_emails.sql",
      "legacy/023_snoozed_emails.sql",
      "legacy/044_legacy_briefing_cleanup.sql",
    ]);
  });

  it("tolerates raw-apply harnesses that have no migrations ledger", async () => {
    db = createClient({ url: "file::memory:" });
    // Test bootstraps (snapshot-test-fixtures, triage test-utils) apply every
    // migration file raw via executeMultiple, without the runner — so 024 must
    // not assume the migrations table exists.
    await applyMigrations(db, ["024_retire_legacy_ledger_rows.sql"]);

    const ledger = await db.execute("SELECT name FROM migrations");
    expect(ledger.rows).toEqual([]);
  });

  it("adds the bounded carryover depth counter to snapshot items", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "018_carryover_depth_bound.sql",
    ]);

    const columns = await db.execute("PRAGMA table_info('ea_briefing_snapshot_items')");
    const column = columns.rows.find((row) => row.name === "carryover_count")!;

    expect(column).toBeDefined();
    expect(column.type).toBe("INTEGER");
    expect(column.notnull).toBe(1);
    expect(column.dflt_value).toBe("0");

    await db.execute({
      sql: `INSERT INTO ea_briefing_snapshots (user_id, start_at, end_at, timezone, status)
            VALUES ('user-1', '2026-05-03T07:00:00.000Z', '2026-05-04T07:00:00.000Z', 'America/Los_Angeles', 'active')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO ea_email_triage (user_id, account_id, email_id, lane, triage_status)
            VALUES ('user-1', 'gmail-work', 'msg-1', 'needs_attention', 'complete')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO ea_briefing_snapshot_items
              (snapshot_id, triage_id, user_id, account_id, email_id, lane_at_snapshot)
            VALUES (1, 1, 'user-1', 'gmail-work', 'msg-1', 'needs_attention')`,
      args: [],
    });
    const row = await db.execute("SELECT carryover_count FROM ea_briefing_snapshot_items WHERE email_id = 'msg-1'");
    expect(Number(row.rows[0]!.carryover_count)).toBe(0);
  });
});
