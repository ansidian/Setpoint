import db from "../db/connection.ts";
import type { Client } from "@libsql/client";
import type { RootKeyHealthMetadata } from "../../shared/types/instance-credentials.ts";
import { createEncryption, getRootKeyHealth } from "./encryption.ts";

type RootKeyHealthDb = Pick<Client, "execute">;

const ENCRYPTED_VALUE_QUERIES = [
  "SELECT credentials_encrypted AS value FROM ea_accounts WHERE credentials_encrypted IS NOT NULL",
  `SELECT actual_budget_password_encrypted AS value FROM ea_settings
   WHERE actual_budget_password_encrypted IS NOT NULL`,
  `SELECT todoist_api_token_encrypted AS value FROM ea_settings
   WHERE todoist_api_token_encrypted IS NOT NULL`,
  `SELECT todoist_oauth_refresh_token_encrypted AS value FROM ea_settings
   WHERE todoist_oauth_refresh_token_encrypted IS NOT NULL`,
  `SELECT discord_webhook_url_encrypted AS value FROM ea_settings
   WHERE discord_webhook_url_encrypted IS NOT NULL`,
  `SELECT active_value_encrypted AS value FROM ea_instance_credentials
   WHERE active_value_encrypted IS NOT NULL`,
  `SELECT pending_value_encrypted AS value FROM ea_instance_credentials
   WHERE pending_value_encrypted IS NOT NULL`,
] as const;

export function createRootKeyHealthService({
  dbClient = db,
  environment = process.env,
  encryption = createEncryption(),
}: {
  dbClient?: RootKeyHealthDb;
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  encryption?: ReturnType<typeof createEncryption>;
} = {}) {
  async function getMetadata(): Promise<RootKeyHealthMetadata> {
    const health = getRootKeyHealth(environment.EA_ENCRYPTION_KEY);
    if (!health.valid) return { ...health, decryptability: "unavailable" };
    try {
      for (const sql of ENCRYPTED_VALUE_QUERIES) {
        const result = await dbClient.execute(sql);
        for (const row of result.rows) encryption.decrypt(String(row.value));
      }
      return { ...health, decryptability: "ok" };
    } catch {
      return { ...health, decryptability: "failed" };
    }
  }

  async function assertDecryptable(): Promise<void> {
    const metadata = await getMetadata();
    if (metadata.decryptability === "failed") {
      throw new Error("Stored credentials cannot be decrypted with EA_ENCRYPTION_KEY");
    }
  }

  return { getMetadata, assertDecryptable };
}

export const rootKeyHealthService = createRootKeyHealthService();
