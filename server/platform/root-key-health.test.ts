import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEncryption } from "./encryption.ts";
import { createRootKeyHealthService } from "./root-key-health.ts";

const ROOT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("root key health", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
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
  });

  afterEach(() => db.close());

  it("fails closed with a fixed error when existing ciphertext is not decryptable", async () => {
    await db.execute("INSERT INTO ea_accounts (id, credentials_encrypted) VALUES ('account-1', 'gcm:bad')");
    const service = createRootKeyHealthService({
      dbClient: db,
      environment: { EA_ENCRYPTION_KEY: ROOT_KEY },
      encryption: createEncryption(() => ROOT_KEY),
    });

    expect(await service.getMetadata()).toMatchObject({ decryptability: "failed" });
    await expect(service.assertDecryptable()).rejects.toThrow(
      "Stored credentials cannot be decrypted with EA_ENCRYPTION_KEY",
    );
  });
});
