import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

describe("remote-content trust migration", () => {
  const db = createClient({ url: "file::memory:" });

  afterEach(() => db.close());

  it("stores trust by owner, receiving account, and normalized sender", async () => {
    for (const file of ["001_ea_tables.sql", "045_email_remote_content_trust.sql"]) {
      await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }

    const columns = await db.execute("PRAGMA table_info('ea_email_remote_content_trust')");
    const columnByName = new Map(columns.rows.map((row) => [row.name, row]));
    expect(columnByName.get("user_id")!.notnull).toBe(1);
    expect(columnByName.get("account_id")!.notnull).toBe(1);
    expect(columnByName.get("sender_address")!.notnull).toBe(1);

    const indexes = await db.execute("PRAGMA index_list('ea_email_remote_content_trust')");
    expect(indexes.rows.some((row) => row.unique === 1)).toBe(true);
  });
});
