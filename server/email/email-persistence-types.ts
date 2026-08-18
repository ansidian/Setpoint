import type { InStatement, TransactionMode } from "@libsql/client";

export interface EmailDbResult {
  rows: Record<string, unknown>[];
  rowsAffected?: number;
}

export interface EmailReadDb {
  execute(statement: string | InStatement): Promise<EmailDbResult>;
}

export interface EmailWriteDb extends EmailReadDb {
  batch(statements: InStatement[], mode?: TransactionMode): Promise<EmailDbResult[]>;
}

export interface EmailAccountRow extends Record<string, unknown> {
  id: string;
  label: string;
  email: string;
  type: "gmail" | "icloud";
}

export interface ExistingEmailIndexRow extends Record<string, unknown> {
  rowid: number;
  uid: string;
  from_name?: string | null;
  from_address?: string | null;
  subject?: string | null;
  body_snippet?: string | null;
  body_text?: string | null;
  email_date?: string | null;
  email_date_utc?: string | null;
  read?: number | boolean | null;
  thread_id?: string | null;
  message_id?: string | null;
  verification_code?: string | null;
  verification_code_kind?: string | null;
  verification_code_detected_at?: string | null;
  verification_code_active_until?: string | null;
  verification_code_detector_version?: number | null;
}
