import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("./connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
  },
}));
vi.mock("../platform/encryption.js", () => ({
  encrypt: vi.fn((value) => `gcm:${value}`),
  decrypt: vi.fn((value) => value.replace(/^aabb:/, "")),
}));

const { migrateCbcEncryption } = await import("./migrate-encryption.js");

async function createDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      discord_webhook_url_encrypted TEXT
    );
  `);
  await db.execute({
    sql: "INSERT INTO ea_settings (user_id, discord_webhook_url_encrypted) VALUES (?, ?)",
    args: ["user-1", "aabb:ccdd"],
  });
  return db;
}

describe("migrateCbcEncryption TARGETS coverage (SEC-07 part 1)", () => {
  const originalKey = process.env.EA_ENCRYPTION_KEY;

  beforeEach(async () => {
    process.env.EA_ENCRYPTION_KEY = "test-key";
    testState.db.current = await createDb();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
    if (originalKey === undefined) delete process.env.EA_ENCRYPTION_KEY;
    else process.env.EA_ENCRYPTION_KEY = originalKey;
  });

  it("rewrites a legacy CBC discord_webhook_url_encrypted value to the GCM shape", async () => {
    await migrateCbcEncryption();

    const { rows } = await testState.db.current.execute({
      sql: "SELECT discord_webhook_url_encrypted AS val FROM ea_settings WHERE user_id = ?",
      args: ["user-1"],
    });

    expect(rows[0].val).toBe("gcm:ccdd");
  });
});
