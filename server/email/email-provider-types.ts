import type { EmailBody, EmailProvider } from "../../shared/types/email.ts";

export interface ConfiguredEmailAccount extends Record<string, unknown> {
  id: string;
  type: EmailProvider;
  email: string;
  label: string;
  color: string;
  icon?: string | null;
  credentials_encrypted: string;
  canonical_id?: string;
  uid_account_id?: string;
  needs_reauth?: boolean | number;
  sort_order?: number;
}

export interface EmailProviderAdapter {
  type: EmailProvider;
  account: ConfiguredEmailAccount;
  providerAccountId: string;
  fetchBody: () => Promise<EmailBody>;
  markRead: () => Promise<void>;
  markUnread: () => Promise<void>;
  trash: () => Promise<void>;
}

export type EmailHttpError = Error & { status: number };

export function emailErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
