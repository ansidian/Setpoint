export interface GmailSyncAccount extends Record<string, unknown> {
  id: string;
  user_id: string;
  email: string;
  type?: "gmail";
  label?: string;
  color?: string;
  icon?: string | null;
  credentials_encrypted?: string;
  canonical_id?: string;
  uid_account_id?: string;
}

export interface GmailHistoryMessage {
  id?: string;
  labelIds?: string[];
}

export interface GmailHistoryEvent {
  message?: GmailHistoryMessage;
  labelIds?: string[];
}

export interface GmailHistoryRecord {
  id?: string;
  messagesAdded?: GmailHistoryEvent[];
  labelsAdded?: GmailHistoryEvent[];
  labelsRemoved?: GmailHistoryEvent[];
  messagesDeleted?: GmailHistoryEvent[];
}

export interface GmailHistoryPage {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string | null;
}

export interface GmailMessageMetadata {
  labelIds?: string[];
}

export type GmailProviderRemovalEvent = "inbox_removed" | "trash_added" | "message_deleted";

export type GmailProviderState = "trashed" | "archived";

export interface GmailWatchResponse {
  historyId?: string;
  expiration?: string;
}

export interface EmailHttpResponse {
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type EmailFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<EmailHttpResponse>;

export type GmailSyncError = Error & {
  status?: number;
  recoverViaLookback?: boolean;
};

export function syncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
