import { createClient, type Client } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const RETIREMENT = "084_retire_legacy_financial_documents.sql";
const REASON = "Retired with the legacy financial assessment path.";

function read(file: string): string {
  return readFileSync(join(migrationsDir, file), "utf8");
}

describe("legacy financial document retirement migration", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql") && name < RETIREMENT).sort()) {
      await db.executeMultiple(read(file));
    }
    await db.execute(`INSERT INTO ea_financial_events (id, user_id, created_at, updated_at) VALUES ('event-1', 'owner', 1, 1)`);
  });

  afterEach(() => db.close());

  async function insertDocument(uid: string, fields: Record<string, string | number | null> = {}): Promise<void> {
    const row = { status: "pending", processing_policy: "legacy", revision: 2, processed_revision: 1, ...fields };
    const columns = Object.keys(row);
    await db.execute({
      sql: `INSERT INTO ea_financial_documents (user_id, account_id, email_uid, created_at, updated_at, ${columns.join(", ")})
            VALUES ('owner', 'gmail', ?, 1, 1, ${columns.map(() => "?").join(", ")})`,
      args: [uid, ...Object.values(row)],
    });
  }

  async function documents() {
    const result = await db.execute(`SELECT email_uid, status, dismissed_at, last_error, next_attempt_at, revision, processed_revision
      FROM ea_financial_documents ORDER BY email_uid`);
    return Object.fromEntries(result.rows.map((row) => [row.email_uid, { ...row }]));
  }

  it("dismisses unfinished eventless legacy documents and leaves every other source untouched", async () => {
    await insertDocument("legacy-pending");
    await insertDocument("legacy-retry", { status: "retry", next_attempt_at: 5_000, last_error: "provider unavailable" });
    await insertDocument("provider", { processing_policy: "provider_v1" });
    await insertDocument("associated", { event_id: "event-1" });
    await insertDocument("owner-requested", { owner_requested_at: 10 });
    await insertDocument("settled", { status: "ignored", revision: 1, processed_revision: 1 });
    const before = await documents();

    await db.executeMultiple(read(RETIREMENT));

    const after = await documents();
    for (const uid of ["legacy-pending", "legacy-retry"]) {
      expect(after[uid]).toMatchObject({
        status: "ignored", last_error: REASON, next_attempt_at: null, revision: 3, processed_revision: 3,
      });
      expect(Number(after[uid]!.dismissed_at)).toBeGreaterThan(0);
    }
    for (const uid of ["provider", "associated", "owner-requested", "settled"]) {
      expect(after[uid]).toEqual(before[uid]);
    }
  });
});
