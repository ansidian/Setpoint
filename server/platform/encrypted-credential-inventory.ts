import type { Client } from "@libsql/client";
import type { CredentialEncryptionContext } from "./encryption.ts";
import {
  accountCredentialContext,
  instanceCredentialContext,
  settingsCredentialContext,
  type EncryptedSettingsField,
} from "./credential-encryption-context.ts";
import { isInstanceCredentialKey } from "./instance-credential-registry.ts";

type InventoryDb = Pick<Client, "execute">;

export type EncryptedCredentialTarget = Readonly<{
  name: string;
  selectSql: string;
  updateSql: string;
  context(recordId: string): CredentialEncryptionContext;
}>;

function settingsTarget(field: EncryptedSettingsField): EncryptedCredentialTarget {
  return {
    name: `ea_settings.${field}`,
    selectSql: `SELECT user_id AS record_id, ${field} AS value FROM ea_settings WHERE ${field} IS NOT NULL`,
    updateSql: `UPDATE ea_settings SET ${field} = ? WHERE user_id = ? AND ${field} = ?`,
    context: (recordId) => settingsCredentialContext(recordId, field),
  };
}

function instanceContext(recordId: string): CredentialEncryptionContext {
  if (!isInstanceCredentialKey(recordId)) {
    throw new Error("Encrypted credential inventory contains an unsupported key");
  }
  return instanceCredentialContext(recordId);
}

export const ENCRYPTED_CREDENTIAL_TARGETS: readonly EncryptedCredentialTarget[] = [
  {
    name: "ea_accounts.credentials_encrypted",
    selectSql: "SELECT id AS record_id, credentials_encrypted AS value FROM ea_accounts WHERE credentials_encrypted IS NOT NULL",
    updateSql: "UPDATE ea_accounts SET credentials_encrypted = ? WHERE id = ? AND credentials_encrypted = ?",
    context: accountCredentialContext,
  },
  settingsTarget("actual_budget_password_encrypted"),
  settingsTarget("todoist_api_token_encrypted"),
  settingsTarget("todoist_oauth_refresh_token_encrypted"),
  settingsTarget("discord_webhook_url_encrypted"),
  {
    name: "ea_instance_credentials.active_value_encrypted",
    selectSql: "SELECT credential_key AS record_id, active_value_encrypted AS value FROM ea_instance_credentials WHERE active_value_encrypted IS NOT NULL",
    updateSql: "UPDATE ea_instance_credentials SET active_value_encrypted = ? WHERE credential_key = ? AND active_value_encrypted = ?",
    context: instanceContext,
  },
  {
    name: "ea_instance_credentials.pending_value_encrypted",
    selectSql: "SELECT credential_key AS record_id, pending_value_encrypted AS value FROM ea_instance_credentials WHERE pending_value_encrypted IS NOT NULL",
    updateSql: "UPDATE ea_instance_credentials SET pending_value_encrypted = ? WHERE credential_key = ? AND pending_value_encrypted = ?",
    context: instanceContext,
  },
] as const;

export type EncryptedCredentialRecord = Readonly<{
  target: EncryptedCredentialTarget;
  recordId: string;
  ciphertext: string;
  context: CredentialEncryptionContext;
}>;

export async function readEncryptedCredentialInventory(
  dbClient: InventoryDb,
): Promise<EncryptedCredentialRecord[]> {
  const records: EncryptedCredentialRecord[] = [];
  for (const target of ENCRYPTED_CREDENTIAL_TARGETS) {
    const result = await dbClient.execute(target.selectSql);
    for (const row of result.rows) {
      if (typeof row.record_id !== "string" || typeof row.value !== "string") {
        throw new Error("Encrypted credential inventory contains an invalid row");
      }
      records.push({
        target,
        recordId: row.record_id,
        ciphertext: row.value,
        context: target.context(row.record_id),
      });
    }
  }
  return records;
}
