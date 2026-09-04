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

describe("authentication security migrations", () => {
  let db: Client | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
  });

  it("adds generation and authentication provenance while invalidating pending ceremonies", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "012_passkey_auth.sql",
      "030_owner_bootstrap.sql",
      "031_auth_recovery.sql",
    ]);
    await db.execute(`INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at)
                      VALUES (1, 'owner-1', 'hash', 100)`);
    await db.execute(`INSERT INTO ea_sessions (token, expires_at, authenticated_at)
                      VALUES ('session', 999999, 500)`);
    await db.execute(`INSERT INTO ea_pending_auth (token_hash, user_id, created_at, expires_at)
                      VALUES ('pending', 'owner-1', 100, 999999)`);
    await db.execute(`INSERT INTO ea_webauthn_challenges
                        (challenge_hash, user_id, challenge_type, created_at, expires_at)
                      VALUES ('challenge', 'owner-1', 'authentication', 100, 999999)`);

    await applyMigrations(db, [
      "038_auth_security_generation.sql",
      "039_password_step_up_window.sql",
    ]);

    const owner = await db.execute("SELECT security_generation FROM ea_owner");
    const session = await db.execute(
      `SELECT security_generation, auth_method, password_authenticated_at,
              step_up_failure_count, step_up_blocked_until
              , step_up_window_started_at
         FROM ea_sessions`,
    );
    expect(owner.rows).toEqual([{ security_generation: 1 }]);
    expect(session.rows).toEqual([{
      security_generation: 1,
      auth_method: "legacy",
      password_authenticated_at: 0,
      step_up_failure_count: 0,
      step_up_blocked_until: 0,
      step_up_window_started_at: 0,
    }]);
    expect((await db.execute("SELECT * FROM ea_pending_auth")).rows).toEqual([]);
    expect((await db.execute("SELECT * FROM ea_webauthn_challenges")).rows).toEqual([]);
  });

  it("revokes replayable sessions and ceremonies while preserving owner credentials", async () => {
    db = createClient({ url: "file::memory:" });
    await applyMigrations(db, [
      "001_ea_tables.sql",
      "012_passkey_auth.sql",
      "030_owner_bootstrap.sql",
      "031_auth_recovery.sql",
      "038_auth_security_generation.sql",
      "039_password_step_up_window.sql",
    ]);
    await db.execute(`INSERT INTO ea_owner
                        (singleton_id, user_id, password_hash, claimed_at, security_generation)
                      VALUES (1, 'owner-1', 'owner-password-hash', 100, 7)`);
    await db.execute(`INSERT INTO ea_passkey_credentials
                        (credential_id, user_id, label, public_key, sign_count, created_at)
                      VALUES ('credential-1', 'owner-1', 'Owner passkey', 'public-key', 42, 100)`);
    await db.execute(`INSERT INTO ea_sessions (token, expires_at, security_generation)
                      VALUES ('legacy-raw-token', 999999, 7),
                             ('sha256:stored-hash', 999999, 7)`);
    await db.execute(`INSERT INTO ea_pending_auth
                        (token_hash, user_id, created_at, expires_at, security_generation)
                      VALUES ('pending', 'owner-1', 100, 999999, 7)`);
    await db.execute(`INSERT INTO ea_webauthn_challenges
                        (challenge_hash, user_id, challenge_type, created_at, expires_at, security_generation)
                      VALUES ('challenge', 'owner-1', 'authentication', 100, 999999, 7)`);
    const passkeysBefore = (await db.execute("SELECT * FROM ea_passkey_credentials")).rows;

    await applyMigrations(db, ["060_revoke_legacy_sessions.sql"]);

    expect((await db.execute("SELECT * FROM ea_sessions")).rows).toEqual([]);
    expect((await db.execute("SELECT * FROM ea_pending_auth")).rows).toEqual([]);
    expect((await db.execute("SELECT * FROM ea_webauthn_challenges")).rows).toEqual([]);
    expect((await db.execute(
      "SELECT user_id, password_hash, security_generation FROM ea_owner",
    )).rows).toEqual([{
      user_id: "owner-1",
      password_hash: "owner-password-hash",
      security_generation: 8,
    }]);
    expect((await db.execute("SELECT * FROM ea_passkey_credentials")).rows).toEqual(passkeysBefore);
  });

  it("adds password step-up window state in a forward migration", async () => {
    db = createClient({ url: "file::memory:" });
    await db.execute(`CREATE TABLE ea_sessions (
      token TEXT PRIMARY KEY,
      step_up_failure_count INTEGER NOT NULL DEFAULT 0,
      step_up_blocked_until INTEGER NOT NULL DEFAULT 0
    )`);

    await applyMigrations(db, ["039_password_step_up_window.sql"]);

    const columns = await db.execute("PRAGMA table_info('ea_sessions')");
    expect(columns.rows.map((row) => row.name)).toContain("step_up_window_started_at");
  });
});
