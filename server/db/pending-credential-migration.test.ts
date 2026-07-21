import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

describe("pending credential lifecycle migration", () => {
  const db = createClient({ url: "file::memory:" });

  afterEach(() => db.close());

  it("adds durable timestamps and backfills legacy candidates", async () => {
    await db.executeMultiple(readFileSync(join(migrationsDir, "033_instance_credentials.sql"), "utf8"));
    await db.execute({
      sql: `INSERT INTO ea_instance_credentials
              (credential_key, pending_value_encrypted, validation_state, updated_at)
            VALUES (?, ?, 'pending', ?)`,
      args: ["ai.openai_api_key", "legacy-ciphertext", 1_000],
    });

    await db.executeMultiple(readFileSync(join(migrationsDir, "040_pending_credential_lifecycle.sql"), "utf8"));

    const row = (await db.execute(
      `SELECT pending_staged_at, pending_expires_at
       FROM ea_instance_credentials WHERE credential_key = 'ai.openai_api_key'`,
    )).rows[0];
    expect(row).toEqual({ pending_staged_at: 1_000, pending_expires_at: 86_401_000 });
    const columns = await db.execute("PRAGMA index_info('idx_instance_credentials_pending_expiry')");
    expect(columns.rows.map((entry) => entry.name)).toEqual(["pending_expires_at"]);
  });
});
