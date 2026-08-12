import type { InStatement, TransactionMode } from "@libsql/client";

export interface SnapshotDbResult {
  rows: Record<string, unknown>[];
  rowsAffected?: number;
}

export interface SnapshotReadDb {
  execute(statement: string | InStatement): Promise<SnapshotDbResult>;
}

export interface SnapshotWriteDb extends SnapshotReadDb {
  batch(statements: InStatement[], mode?: TransactionMode): Promise<SnapshotDbResult[]>;
}

export interface SnapshotEmailSource extends Record<string, unknown> {
  uid?: string;
  id?: string;
  email_id?: string;
  thread_id?: string | null;
  threadId?: string;
  account_id?: string;
  accountId?: string;
  account_email?: string;
  account_label?: string;
  account_color?: string;
  account_icon?: string;
  from?: string;
  from_name?: string;
  from_address?: string;
  from_email?: string;
  fromEmail?: string;
  subject?: string;
  date?: string;
  email_date?: string;
  email_date_at_snapshot?: string;
  read?: boolean | number | string | null;
  summary?: string;
  preview?: string;
  body_preview?: string;
  action?: string;
  urgency?: string;
  deadline_at?: string | null;
  category?: string;
  escalation_badge?: string | null;
  urgentFlag?: { label?: string } | null;
  _accountKey?: string;
  _lane?: string;
  lane?: string;
}

export type HttpError = Error & { status: number };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}
