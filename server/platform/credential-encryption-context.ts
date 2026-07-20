import type { CredentialEncryptionContext } from "./encryption.ts";
import type { InstanceCredentialKey } from "./instance-credential-registry.ts";

export type EncryptedSettingsField =
  | "actual_budget_password_encrypted"
  | "todoist_api_token_encrypted"
  | "todoist_oauth_refresh_token_encrypted"
  | "discord_webhook_url_encrypted";

export function accountCredentialContext(accountId: string): CredentialEncryptionContext {
  return { table: "ea_accounts", field: "credentials_encrypted", recordId: accountId };
}

export function settingsCredentialContext(
  userId: string,
  field: EncryptedSettingsField,
): CredentialEncryptionContext {
  return { table: "ea_settings", field, recordId: userId };
}

export function instanceCredentialContext(
  key: InstanceCredentialKey,
): CredentialEncryptionContext {
  return { table: "ea_instance_credentials", field: "credential_value", recordId: key };
}
