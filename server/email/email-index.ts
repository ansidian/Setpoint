import db from "../db/connection.ts";
import { normalizeEmailDateUtc } from "./email-date.ts";
import { detectVerificationCode } from "./verification-code-detector.ts";
import type { InStatement } from "@libsql/client";
import type {
  EmailIndexBackfillResponse,
  EmailIndexHealthResponse,
  NormalizedFetchedEmail,
} from "../../shared/types/email.ts";
import type {
  EmailAccountRow,
  EmailWriteDb,
  ExistingEmailIndexRow,
} from "./email-persistence-types.ts";

interface EmailIndexHealthOptions {
  mailboxScope?: string;
}

interface QueueEmailIndexBackfillOptions extends EmailIndexHealthOptions {
  targetDays?: unknown;
  now?: Date;
}

export const EMAIL_INDEX_BODY_TEXT_MAX_CHARS = 20_000;
const EMAIL_INDEX_LOOKUP_CHUNK_SIZE = 500;

// Loose check that a token looks like a single bare email address.
// Intentionally permissive (no full RFC parse) but rejects whitespace and
// display-name fragments so we never store a name in from_address.
const EMAIL_SHAPE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

// Strip a single balanced surrounding quote pair from a display name,
// e.g. "Doe, John" -> Doe, John  but leaves 5" or O'Brien untouched.
function stripBalancedQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

// split Gmail's "Display Name <addr>" into components
// iCloud already provides from_email separately
export function parseFrom(email: { from?: string; from_email?: string }): { fromName: string; fromAddress: string } {
  if (email.from_email) {
    return { fromName: email.from || "", fromAddress: email.from_email };
  }

  const raw = (email.from || "").trim();

  // Angle-bracket form: only treat the bracketed token as the address when it
  // actually looks like an email. Otherwise fall through and keep the whole
  // string as a display name rather than emitting a malformed address.
  const match = raw.match(/^(.*)<([^>]*)>\s*$/);
  if (match) {
    const address = match[2]!.trim();
    if (EMAIL_SHAPE.test(address)) {
      return {
        fromName: stripBalancedQuotes(match[1]!),
        fromAddress: address,
      };
    }
  }

  // No usable angle-bracket address: only assign from_address when the bare
  // token is itself email-shaped; anything else is a display name.
  if (EMAIL_SHAPE.test(raw)) {
    return { fromName: "", fromAddress: raw };
  }

  return { fromName: stripBalancedQuotes(raw), fromAddress: "" };
}

function safeJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toIsoDate(value: string | number | Date | null | undefined): string | null {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

function oldestTargetDate(targetDays: number, now: Date): string | null {
  return toIsoDate(new Date(now.getTime() - targetDays * 24 * 60 * 60 * 1000));
}

function normalizeTargetDays(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 365;
  return Math.min(parsed, 3650);
}

async function listEmailAccounts(userId: string): Promise<EmailAccountRow[]> {
  const result = await db.execute({
    sql: `SELECT id, label, email, type
          FROM ea_accounts
          WHERE user_id = ? AND type IN ('gmail', 'icloud')
          ORDER BY sort_order ASC, created_at ASC`,
    args: [userId],
  });
  return result.rows.filter((row) => row.type === "gmail" || row.type === "icloud") as unknown as EmailAccountRow[];
}

export async function getEmailIndexHealth(userId: string, { mailboxScope = "inbox" }: EmailIndexHealthOptions = {}): Promise<EmailIndexHealthResponse> {
  const accounts = await listEmailAccounts(userId);
  if (!accounts.length) {
    return { accounts: [] };
  }

  const [indexResult, stateResult] = await Promise.all([
    db.execute({
      sql: `SELECT account_id,
                   COUNT(*) AS indexed_count,
                   MIN(NULLIF(email_date_utc, '')) AS oldest_indexed_date,
                   MAX(NULLIF(email_date_utc, '')) AS newest_indexed_date,
                   MAX(indexed_at) AS last_indexed_at
            FROM ea_email_index
            WHERE user_id = ?
            GROUP BY account_id`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT account_id, mailbox_scope, status, target_days,
                   oldest_target_date, oldest_indexed_date, last_scanned_at,
                   cursor_json, indexed_count, last_error, attempts,
                   started_at, completed_at, updated_at
            FROM ea_email_backfill_state
            WHERE user_id = ? AND mailbox_scope = ?`,
      args: [userId, mailboxScope],
    }),
  ]);

  const indexByAccount = new Map(indexResult.rows.map((row) => [String(row.account_id), row]));
  const stateByAccount = new Map(stateResult.rows.map((row) => [String(row.account_id), row]));

  return {
    accounts: accounts.map((account) => {
      const index: Record<string, unknown> = indexByAccount.get(account.id) || {};
      const state = stateByAccount.get(account.id);
      const cursor = safeJson(state?.cursor_json);
      return {
        account_id: account.id,
        label: account.label,
        email: account.email,
        type: account.type,
        indexed_count: Number(index.indexed_count || 0),
        oldest_indexed_date: index.oldest_indexed_date || null,
        newest_indexed_date: index.newest_indexed_date || null,
        last_indexed_at: index.last_indexed_at || null,
        backfill: state ? {
          mailbox_scope: state.mailbox_scope,
          status: state.status,
          target_days: state.target_days,
          oldest_target_date: state.oldest_target_date,
          oldest_indexed_date: state.oldest_indexed_date,
          last_scanned_at: state.last_scanned_at,
          current_window: cursor.currentWindow || null,
          cursor_json: cursor,
          indexed_count: Number(state.indexed_count || 0),
          last_error: state.last_error || "",
          attempts: Number(state.attempts || 0),
          started_at: state.started_at || null,
          completed_at: state.completed_at || null,
          updated_at: state.updated_at || null,
        } : {
          mailbox_scope: mailboxScope,
          status: "not_started",
          target_days: null,
          oldest_target_date: null,
          oldest_indexed_date: null,
          last_scanned_at: null,
          current_window: null,
          cursor_json: {},
          indexed_count: 0,
          last_error: "",
          attempts: 0,
          started_at: null,
          completed_at: null,
          updated_at: null,
        },
      };
    }),
  };
}

export async function queueEmailIndexBackfill(userId: string, {
  targetDays,
  mailboxScope = "inbox",
  now = new Date(),
}: QueueEmailIndexBackfillOptions = {}): Promise<EmailIndexBackfillResponse> {
  const normalizedTargetDays = normalizeTargetDays(targetDays);
  const targetDate = oldestTargetDate(normalizedTargetDays, now);
  const accounts = await listEmailAccounts(userId);
  if (!accounts.length) {
    return {
      queued: false,
      mailbox_scope: mailboxScope,
      target_days: normalizedTargetDays,
      oldest_target_date: targetDate,
      accounts: [],
    };
  }

  const stmts = accounts.map((account) => ({
    sql: `INSERT INTO ea_email_backfill_state
            (user_id, account_id, mailbox_scope, status, target_days,
             oldest_target_date, cursor_json, attempts, started_at,
             completed_at, updated_at)
          VALUES (?, ?, ?, 'queued', ?, ?, '{}', 0, NULL, NULL, datetime('now'))
          ON CONFLICT(user_id, account_id, mailbox_scope) DO UPDATE SET
            status = CASE
              WHEN ea_email_backfill_state.status = 'running' THEN ea_email_backfill_state.status
              ELSE 'queued'
            END,
            target_days = excluded.target_days,
            oldest_target_date = excluded.oldest_target_date,
            last_error = '',
            completed_at = NULL,
            updated_at = datetime('now')`,
    args: [userId, account.id, mailboxScope, normalizedTargetDays, targetDate],
  }));

  await db.batch(stmts);

  return {
    queued: true,
    mailbox_scope: mailboxScope,
    target_days: normalizedTargetDays,
    oldest_target_date: targetDate,
    accounts: accounts.map((account) => ({
      account_id: account.id,
      label: account.label,
      email: account.email,
      type: account.type,
      status: "queued",
    })),
  };
}

async function loadExistingIndexRows(userId: string, uids: string[], { dbClient }: { dbClient: EmailWriteDb }): Promise<Map<string, ExistingEmailIndexRow>> {
  const rows: ExistingEmailIndexRow[] = [];
  for (let i = 0; i < uids.length; i += EMAIL_INDEX_LOOKUP_CHUNK_SIZE) {
    const chunk = uids.slice(i, i + EMAIL_INDEX_LOOKUP_CHUNK_SIZE);
    const result = await dbClient.execute({
      sql: `SELECT rowid, uid, from_name, from_address, subject, body_snippet, body_text,
                   email_date, email_date_utc, read, thread_id, message_id,
                   verification_code, verification_code_kind,
                   verification_code_detected_at, verification_code_active_until,
                   verification_code_detector_version, sender_authentication_json
            FROM ea_email_index
            WHERE user_id = ?
              AND uid IN (${chunk.map(() => "?").join(",")})`,
      args: [userId, ...chunk],
    });
    rows.push(...result.rows as ExistingEmailIndexRow[]);
  }
  return new Map(rows.map((row) => [row.uid, row]));
}

function dedupeEmailsByUid(emails: NormalizedFetchedEmail[]): NormalizedFetchedEmail[] {
  const byUid = new Map<string, NormalizedFetchedEmail>();
  for (const email of emails) {
    if (!email?.uid) continue;
    byUid.set(email.uid, email);
  }
  return [...byUid.values()];
}

export async function indexEmails(userId: string, emails: NormalizedFetchedEmail[], {
  dbClient = db,
  now = new Date(),
}: { dbClient?: EmailWriteDb; now?: Date } = {}): Promise<void> {
  if (!emails.length) return;
  const uniqueEmails = dedupeEmailsByUid(emails);
  if (!uniqueEmails.length) return;

  const existingRows = await loadExistingIndexRows(
    userId,
    uniqueEmails.map((email) => email.uid),
    { dbClient },
  );
  const stmts: InStatement[] = uniqueEmails.flatMap((email): InStatement[] => {
    const { fromName, fromAddress } = parseFrom(email);
    const uid = email.uid;
    const subject = email.subject || "";
    const bodySnippet = email.body_preview || "";
    const bodyText = String(email.body_text || "").slice(0, EMAIL_INDEX_BODY_TEXT_MAX_CHARS);
    const emailDate = email.date || "";
    const emailDateUtc = normalizeEmailDateUtc(emailDate);
    const read = email.read ? 1 : 0;
    const threadId = email.thread_id || null;
    const messageId = email.message_id || null;
    const senderAuthenticationJson = email.sender_authentication
      ? JSON.stringify(email.sender_authentication)
      : null;
    const existing = existingRows.get(uid);
    const verificationDetection = detectVerificationCode({
      subject,
      snippet: bodySnippet,
      bodyText,
      emailTimestamp: emailDateUtc,
    });
    const verificationCode = verificationDetection?.code ?? null;
    const verificationCodeKind = verificationDetection?.kind ?? null;
    const verificationCodeActiveUntil = verificationDetection?.activeUntil ?? null;
    const verificationCodeDetectorVersion = verificationDetection?.detectorVersion ?? null;
    const verificationMetadataChanged = !existing
      || (existing.verification_code ?? null) !== verificationCode
      || (existing.verification_code_kind ?? null) !== verificationCodeKind
      || (existing.verification_code_active_until ?? null) !== verificationCodeActiveUntil
      || (existing.verification_code_detector_version ?? null) !== verificationCodeDetectorVersion;
    const verificationCodeDetectedAt = verificationDetection
      ? verificationMetadataChanged
        ? now.toISOString()
        : existing?.verification_code_detected_at ?? now.toISOString()
      : null;
    // P3-2: body_snippet is the volatile Gmail preview and is NOT part of the
    // searchable-content set. A snippet-only drift (common at backfill window
    // boundaries) must not trigger the 3-statement FTS rewrite + embedding
    // invalidation below — it rides the cheap metadata UPDATE instead, keeping
    // the displayed preview fresh without re-embedding the message.
    const searchableChanged = !existing
      || existing.from_name !== fromName
      || existing.from_address !== fromAddress
      || existing.subject !== subject
      || existing.body_text !== bodyText;
    const snippetChanged = !existing || existing.body_snippet !== bodySnippet;
    const indexMetadataChanged = !existing
      || existing.email_date !== emailDate
      || existing.email_date_utc !== emailDateUtc
      || (threadId && threadId !== existing.thread_id)
      || (messageId && messageId !== existing.message_id)
      || (senderAuthenticationJson && senderAuthenticationJson !== existing.sender_authentication_json)
      || verificationMetadataChanged;
    if (!searchableChanged) {
      if (!indexMetadataChanged && !snippetChanged && Number(existing.read) === read) return [];
      // Identity columns COALESCE so a fetch path that lacks them (or a
      // pre-identity cached row) never nulls out stored values.
      return [{
        sql: `UPDATE ea_email_index
              SET body_snippet = ?,
                  email_date = ?,
                  email_date_utc = ?,
                  read = ?,
                  thread_id = COALESCE(?, thread_id),
                  message_id = COALESCE(?, message_id),
                  sender_authentication_json = COALESCE(?, sender_authentication_json),
                  verification_code = ?,
                  verification_code_kind = ?,
                  verification_code_detected_at = ?,
                  verification_code_active_until = ?,
                  verification_code_detector_version = ?
              WHERE uid = ? AND user_id = ?`,
        args: [
          bodySnippet, emailDate, emailDateUtc, read, threadId, messageId, senderAuthenticationJson,
          verificationCode, verificationCodeKind, verificationCodeDetectedAt,
          verificationCodeActiveUntil, verificationCodeDetectorVersion, uid, userId,
        ],
      }];
    }

    const args = [
      uid, userId, email.account_id, email.account_label,
      email.account_email, email.account_color || "#818cf8",
      email.account_icon || "Mail", fromName, fromAddress,
      subject, bodySnippet, bodyText,
      emailDate, emailDateUtc, read, threadId, messageId,
      verificationCode, verificationCodeKind, verificationCodeDetectedAt,
      verificationCodeActiveUntil, verificationCodeDetectorVersion, senderAuthenticationJson,
    ];
    // When an already-indexed email's searchable content changed, drop any
    // existing search embedding so the re-embedding worker re-selects it as a
    // missing (CASE=0) candidate. Without this, a re-indexed *older* email whose
    // content changed keeps its stale embedding row and can sit permanently
    // below the worker's recency-ordered scan window, never re-embedding. New
    // emails (no existing index row) have no embedding to invalidate.
    const embeddingInvalidation = existing
      ? [{
        sql: `DELETE FROM ea_email_search_embeddings
              WHERE uid = ? AND user_id = ?`,
        args: [uid, userId],
      }]
      : [];

    return [
      ...embeddingInvalidation,
      // Upsert: insert new rows and refresh provider-derived presentation state
      // plus searchable content without touching indexed_at.
      {
        sql: `INSERT INTO ea_email_index
              (uid, user_id, account_id, account_label, account_email,
               account_color, account_icon, from_name, from_address,
               subject, body_snippet, body_text, email_date, email_date_utc, read,
               thread_id, message_id, verification_code, verification_code_kind,
               verification_code_detected_at, verification_code_active_until,
               verification_code_detector_version, sender_authentication_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(uid) DO UPDATE SET
                account_id = excluded.account_id,
                account_label = excluded.account_label,
                account_email = excluded.account_email,
                account_color = excluded.account_color,
                account_icon = excluded.account_icon,
                from_name = excluded.from_name,
                from_address = excluded.from_address,
                subject = excluded.subject,
                body_snippet = excluded.body_snippet,
                body_text = excluded.body_text,
                email_date = excluded.email_date,
                email_date_utc = excluded.email_date_utc,
                read = excluded.read,
                thread_id = COALESCE(excluded.thread_id, ea_email_index.thread_id),
                message_id = COALESCE(excluded.message_id, ea_email_index.message_id),
                sender_authentication_json = COALESCE(excluded.sender_authentication_json, ea_email_index.sender_authentication_json),
                verification_code = excluded.verification_code,
                verification_code_kind = excluded.verification_code_kind,
                verification_code_detected_at = excluded.verification_code_detected_at,
                verification_code_active_until = excluded.verification_code_active_until,
                verification_code_detector_version = excluded.verification_code_detector_version`,
        args,
      },
      {
        sql: `DELETE FROM ea_email_fts
              WHERE rowid = (SELECT rowid FROM ea_email_index WHERE uid = ?)`,
        args: [uid],
      },
      {
        sql: `INSERT INTO ea_email_fts
              (rowid, uid, from_name, from_address, subject, body_snippet, body_text)
              VALUES ((SELECT rowid FROM ea_email_index WHERE uid = ?), ?, ?, ?, ?, ?, ?)`,
        args: [uid, uid, fromName, fromAddress, subject, bodySnippet, bodyText],
      },
    ];
  });

  if (stmts.length) await dbClient.batch(stmts);
  console.log(`[EA Index] Indexed ${uniqueEmails.length} email(s)`);
}
