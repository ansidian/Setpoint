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

    expect(columnByName.get("uid").pk).toBe(1);
    expect(columnByName.get("document_text").notnull).toBe(1);
    expect(columnByName.get("source_hash").notnull).toBe(1);
    expect(columnByName.get("document_version").notnull).toBe(1);
    expect(columnByName.get("embedding_model").notnull).toBe(1);
    expect(columnByName.get("embedding_dimensions").notnull).toBe(1);
    expect(columnByName.get("embedding").type).toBe("F32_BLOB(1536)");
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

    expect(columnByName.get("user_id").pk).toBe(1);
    expect(columnByName.get("status").notnull).toBe(1);
    expect(columnByName.get("fresh_embeddings").notnull).toBe(1);
    expect(columnByName.get("stale_embeddings").notnull).toBe(1);
    expect(columnByName.get("missing_embeddings").notnull).toBe(1);
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

    expect(columnByName.get("event_type").notnull).toBe(1);
    expect(columnByName.get("model").notnull).toBe(1);
    expect(columnByName.get("input_tokens").notnull).toBe(1);
    expect(columnByName.get("estimated").notnull).toBe(1);
    expect(columnByName.get("metadata_json").notnull).toBe(1);
    expect(columnByName.has("query_text")).toBe(false);
    expect(columnByName.has("answer_text")).toBe(false);
  });
});
