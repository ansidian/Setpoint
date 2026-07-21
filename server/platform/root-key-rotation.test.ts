import crypto from "crypto";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import {
  accountCredentialContext,
  instanceCredentialContext,
  settingsCredentialContext,
} from "./credential-encryption-context.ts";
import { createEncryption } from "./encryption.ts";
import { rotateRootEncryptionKey } from "./root-key-rotation.ts";

const OLD_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NEW_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function legacyEncrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(OLD_KEY, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `gcm:${iv.toString("hex")}:${encrypted.toString("hex")}:${cipher.getAuthTag().toString("hex")}`;
}

async function ciphertexts(db: Client): Promise<string[]> {
  const rows = await Promise.all([
    db.execute("SELECT credentials_encrypted AS value FROM ea_accounts"),
    db.execute("SELECT actual_budget_password_encrypted AS value FROM ea_settings"),
    db.execute("SELECT todoist_api_token_encrypted AS value FROM ea_settings"),
    db.execute("SELECT todoist_oauth_refresh_token_encrypted AS value FROM ea_settings"),
    db.execute("SELECT discord_webhook_url_encrypted AS value FROM ea_settings"),
    db.execute("SELECT active_value_encrypted AS value FROM ea_instance_credentials"),
    db.execute("SELECT pending_value_encrypted AS value FROM ea_instance_credentials"),
  ]);
  return rows.flatMap((result) => result.rows.map((row) => String(row.value)));
}

describe("root key rotation", () => {
  let db: Client;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestTempDir("root-key-rotation-");
    db = createClient({ url: `file:${path.join(tempDir, "rotation.db")}` });
    await db.executeMultiple(`
      CREATE TABLE ea_accounts (id TEXT PRIMARY KEY, credentials_encrypted TEXT);
      CREATE TABLE ea_settings (
        user_id TEXT PRIMARY KEY,
        actual_budget_password_encrypted TEXT,
        todoist_api_token_encrypted TEXT,
        todoist_oauth_refresh_token_encrypted TEXT,
        discord_webhook_url_encrypted TEXT
      );
      CREATE TABLE ea_instance_credentials (
        credential_key TEXT PRIMARY KEY,
        active_value_encrypted TEXT,
        pending_value_encrypted TEXT
      );
    `);
    const oldEncryption = createEncryption(() => OLD_KEY);
    await db.execute({
      sql: "INSERT INTO ea_accounts VALUES (?, ?)",
      args: ["account-1", legacyEncrypt("account-secret")],
    });
    await db.execute({
      sql: "INSERT INTO ea_settings VALUES (?, ?, ?, ?, ?)",
      args: [
        "owner-1",
        oldEncryption.encrypt("actual-secret", settingsCredentialContext("owner-1", "actual_budget_password_encrypted")),
        legacyEncrypt("todoist-access"),
        oldEncryption.encrypt("todoist-refresh", settingsCredentialContext("owner-1", "todoist_oauth_refresh_token_encrypted")),
        oldEncryption.encrypt("discord-secret", settingsCredentialContext("owner-1", "discord_webhook_url_encrypted")),
      ],
    });
    await db.execute({
      sql: "INSERT INTO ea_instance_credentials VALUES (?, ?, ?)",
      args: [
        "ai.openai_api_key",
        oldEncryption.encrypt("active-secret", instanceCredentialContext("ai.openai_api_key")),
        oldEncryption.encrypt("pending-secret", instanceCredentialContext("ai.openai_api_key")),
      ],
    });
  });

  afterEach(async () => {
    await db.close();
    await removeTempDir(tempDir);
  });

  it("preflights every ciphertext without writing by default", async () => {
    const before = await ciphertexts(db);
    const result = await rotateRootEncryptionKey({ dbClient: db, oldKey: OLD_KEY, newKey: NEW_KEY });

    expect(result).toMatchObject({ applied: false, credentialCount: 7 });
    expect(await ciphertexts(db)).toEqual(before);
  });

  it("atomically rewrites legacy and v2 ciphertext under the new key and context", async () => {
    const result = await rotateRootEncryptionKey({
      dbClient: db,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      apply: true,
    });
    const values = await ciphertexts(db);
    expect(result).toMatchObject({ applied: true, credentialCount: 7 });
    expect(values.every((value) => value.startsWith("gcm:v2:"))).toBe(true);

    const next = createEncryption(() => NEW_KEY);
    expect(next.decrypt(values[0]!, accountCredentialContext("account-1"))).toBe("account-secret");
    expect(next.decrypt(values[1]!, settingsCredentialContext("owner-1", "actual_budget_password_encrypted"))).toBe("actual-secret");
    expect(next.decrypt(values[5]!, instanceCredentialContext("ai.openai_api_key"))).toBe("active-secret");
    expect(next.decrypt(values[6]!, instanceCredentialContext("ai.openai_api_key"))).toBe("pending-secret");
  });

  it("rolls every update back when a mid-rotation write fails", async () => {
    const before = await ciphertexts(db);
    const failingDb = {
      execute: db.execute.bind(db),
      async transaction(mode: "write") {
        const tx = await db.transaction(mode);
        let updates = 0;
        return {
          execute(statement: InStatement | string) {
            const sql = typeof statement === "string" ? statement : statement.sql;
            if (/^UPDATE /i.test(sql) && ++updates === 3) throw new Error("injected write failure");
            return tx.execute(statement);
          },
          commit: () => tx.commit(),
          rollback: () => tx.rollback(),
        };
      },
    };

    await expect(rotateRootEncryptionKey({
      dbClient: failingDb as never,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      apply: true,
    })).rejects.toThrow("injected write failure");
    expect(await ciphertexts(db)).toEqual(before);
  });

  it("rejects equal keys and a wrong old key before writing", async () => {
    await expect(rotateRootEncryptionKey({ dbClient: db, oldKey: OLD_KEY, newKey: OLD_KEY }))
      .rejects.toThrow("must be different");
    await expect(rotateRootEncryptionKey({ dbClient: db, oldKey: NEW_KEY, newKey: OLD_KEY, apply: true }))
      .rejects.toThrow("cannot be decrypted");
  });
});
