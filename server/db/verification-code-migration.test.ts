import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

describe("verification-code migration", () => {
  const db = createClient({ url: "file::memory:" });

  afterEach(() => db.close());

  it("adds nullable verification-code metadata beside the email index", async () => {
    for (const file of ["001_ea_tables.sql", "047_email_verification_codes.sql"]) {
      await db.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }

    const columns = await db.execute("PRAGMA table_info('ea_email_index')");
    const byName = new Map(columns.rows.map((row) => [row.name, row]));

    expect(byName.get("verification_code")!.type).toBe("TEXT");
    expect(byName.get("verification_code_kind")!.type).toBe("TEXT");
    expect(byName.get("verification_code_detected_at")!.type).toBe("TEXT");
    expect(byName.get("verification_code_active_until")!.type).toBe("TEXT");
    expect(byName.get("verification_code_detector_version")!.type).toBe("INTEGER");
    for (const name of [
      "verification_code",
      "verification_code_kind",
      "verification_code_detected_at",
      "verification_code_active_until",
      "verification_code_detector_version",
    ]) {
      expect(byName.get(name)!.notnull).toBe(0);
    }
  });
});
