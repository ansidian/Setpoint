import type { Client, InStatement, Row } from "@libsql/client";
import db from "../db/connection.ts";
import type { BillCandidate, FinancialEmailPlan } from "../../shared/types/bills.ts";
import type { EmailAuthenticationProjection } from "../../shared/types/email.ts";
import type { FinancialOwnerCompletion } from "./financial-event-completion-model.ts";
import type { FinancialEventCompletionEntry } from "../../shared/types/financial-operations.ts";

type StoreDb = Pick<Client, "execute" | "batch">;
type DocumentStatus = "pending" | "processing" | "retry" | "ignored" | "associated";
type EventStatus = "pending" | "processing" | "waiting" | "settled" | "needs_review";
const CLAIM_LEASE_MS = 15 * 60_000;

export interface FinancialStatusDb {
  execute(statement: InStatement): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function readManagedFinancialEmailUids(userId: string, uids: string[], dbClient: FinancialStatusDb = db): Promise<string[]> {
  const unique = [...new Set(uids)].filter(Boolean);
  const managed: string[] = [];
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    const result = await dbClient.execute({
      sql: `SELECT email_uid FROM ea_financial_documents WHERE user_id = ? AND email_uid IN (${chunk.map(() => "?").join(",")})`,
      args: [userId, ...chunk],
    });
    managed.push(...result.rows.map((row) => String(row.email_uid)));
  }
  return managed;
}

export interface FinancialDocument {
  id: number;
  userId: string;
  accountId: string;
  emailUid: string;
  revision: number;
  processedRevision: number;
  status: DocumentStatus;
  attempts: number;
  claimToken: string | null;
  claimedAt: number | null;
  eventId: string | null;
  contentHash: string | null;
  candidate: BillCandidate | null;
  ownerConfirmedEntry: FinancialEventCompletionEntry | null;
  ownerConfirmationConflict: boolean;
  nextAttemptAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  subject: string;
  body: string;
  fromName: string;
  fromAddress: string;
  emailDate: string;
  threadId: string | null;
  messageId: string | null;
  senderAuthentication: EmailAuthenticationProjection | null;
}

export interface FinancialEvent {
  id: string;
  userId: string;
  revision: number;
  status: EventStatus;
  attempts: number;
  claimToken: string | null;
  claimedAt: number | null;
  plan: FinancialEmailPlan | null;
  ownerCompletion: FinancialOwnerCompletion | null;
  operation: unknown | null;
  attemptedAt: number | null;
  outcome: unknown | null;
  reason: string | null;
  collectionDeadline: number | null;
  nextAttemptAt: number | null;
  createdAt: number;
  updatedAt: number;
  documents: FinancialDocument[];
}

const DOCUMENT_SELECT = `SELECT d.*, e.subject, e.body_text, e.from_name, e.from_address,
  e.email_date_utc, e.thread_id, e.message_id, e.sender_authentication_json,
  owner_event.owner_completion_json AS event_owner_completion_json
  FROM ea_financial_documents d LEFT JOIN ea_email_index e
    ON e.user_id = d.user_id AND e.uid = d.email_uid
  LEFT JOIN ea_financial_events owner_event ON owner_event.user_id = d.user_id AND owner_event.id = d.event_id`;
const INTAKE_COMPLETE = `(attempted_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ea_financial_intake_state intake
  WHERE intake.user_id = ea_financial_events.user_id AND intake.enabled = 1
    AND (intake.status IN ('pending', 'processing', 'retry')
      OR julianday(intake.completed_through) < julianday(COALESCE(ea_financial_events.collection_deadline, ea_financial_events.created_at) / 1000.0, 'unixepoch'))))`;
const READY_EVENT = `status IN ('pending', 'waiting') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
  AND ${INTAKE_COMPLETE}
  AND NOT EXISTS (SELECT 1 FROM ea_financial_documents d
    WHERE d.user_id = ea_financial_events.user_id AND d.event_id = ea_financial_events.id
      AND d.processed_revision < d.revision)
  AND (attempted_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ea_financial_documents arrival
    WHERE arrival.user_id = ea_financial_events.user_id AND arrival.status IN ('pending', 'processing')))`;

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function readJson<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function writeJson(value: unknown): string {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Financial workflow data must be JSON serializable");
  return result;
}

function documentFromRow(row: Row): FinancialDocument {
  return {
    id: Number(row.id), userId: String(row.user_id), accountId: String(row.account_id),
    emailUid: String(row.email_uid), revision: Number(row.revision),
    processedRevision: Number(row.processed_revision), status: String(row.status) as DocumentStatus,
    attempts: Number(row.attempts), claimToken: nullableString(row.claim_token),
    claimedAt: nullableNumber(row.claimed_at), eventId: nullableString(row.event_id),
    contentHash: nullableString(row.content_hash), candidate: readJson<BillCandidate>(row.candidate_json),
    ownerConfirmedEntry: readJson<FinancialOwnerCompletion>(row.event_owner_completion_json)?.entry || null,
    ownerConfirmationConflict: Number(row.owner_confirmation_conflict) === 1,
    nextAttemptAt: nullableNumber(row.next_attempt_at), error: nullableString(row.last_error),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    subject: String(row.subject || ""), body: String(row.body_text || ""),
    fromName: String(row.from_name || ""), fromAddress: String(row.from_address || ""),
    emailDate: String(row.email_date_utc || ""), threadId: nullableString(row.thread_id),
    messageId: nullableString(row.message_id),
    senderAuthentication: readJson<EmailAuthenticationProjection>(row.sender_authentication_json),
  };
}

function eventFromRow(row: Row, documents: FinancialDocument[]): FinancialEvent {
  return {
    id: String(row.id), userId: String(row.user_id), revision: Number(row.revision),
    status: String(row.status) as EventStatus, attempts: Number(row.attempts),
    claimToken: nullableString(row.claim_token), claimedAt: nullableNumber(row.claimed_at),
    plan: readJson<FinancialEmailPlan>(row.plan_json), ownerCompletion: readJson<FinancialOwnerCompletion>(row.owner_completion_json),
    operation: readJson(row.operation_json),
    attemptedAt: nullableNumber(row.attempted_at), outcome: readJson(row.outcome_json),
    reason: nullableString(row.reason), collectionDeadline: nullableNumber(row.collection_deadline),
    nextAttemptAt: nullableNumber(row.next_attempt_at),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), documents,
  };
}

export function createFinancialEventStore(dbClient: StoreDb = db, now = Date.now) {
  async function readDocuments(statement: InStatement): Promise<FinancialDocument[]> {
    return (await dbClient.execute(statement)).rows.map(documentFromRow);
  }

  async function releaseChangedClaim(table: "ea_financial_documents" | "ea_financial_events", claim: FinancialDocument | FinancialEvent): Promise<void> {
    await dbClient.execute({
      sql: `UPDATE ${table} SET status = 'pending', claim_token = NULL, claimed_at = NULL,
              next_attempt_at = NULL, updated_at = ?
            WHERE user_id = ? AND id = ? AND claim_token = ? AND revision <> ?`,
      args: [now(), claim.userId, claim.id, claim.claimToken, claim.revision],
    });
  }

  async function claimDocument(claimToken: string): Promise<FinancialDocument | null> {
    if (!claimToken) throw new Error("A financial document claim token is required");
    const timestamp = now();
    const claimed = await dbClient.execute({
      sql: `UPDATE ea_financial_documents SET status = 'processing', claim_token = ?, claimed_at = ?,
              attempts = attempts + 1, updated_at = ?
            WHERE id = (SELECT next.id FROM ea_financial_documents next
              WHERE next.status IN ('pending', 'retry') AND (next.next_attempt_at IS NULL OR next.next_attempt_at <= ?)
                AND NOT EXISTS (SELECT 1 FROM ea_financial_documents busy
                  WHERE busy.user_id = next.user_id AND busy.status = 'processing')
              ORDER BY next.created_at, next.id LIMIT 1)
              AND status IN ('pending', 'retry') RETURNING *`,
      args: [claimToken, timestamp, timestamp, timestamp],
    });
    const row = claimed.rows[0];
    if (!row) return null;
    const result = await readDocuments({ sql: `${DOCUMENT_SELECT} WHERE d.user_id = ? AND d.id = ?`, args: [row.user_id!, row.id!] });
    // Keep the claimed revision even if the source changed before the read.
    return result[0] ? { ...result[0], revision: Number(row.revision), claimToken } : null;
  }

  async function settleDocument(claim: FinancialDocument, input: {
    candidate: BillCandidate | null;
    contentHash: string;
    status: "ignored" | "retry";
    nextAttemptAt?: number | null;
    error?: string | null;
  }): Promise<boolean> {
    const timestamp = now();
    const results = await dbClient.batch([
      {
        sql: `UPDATE ea_financial_events SET revision = revision + 1,
                status = CASE WHEN status = 'processing' THEN status ELSE 'pending' END,
                next_attempt_at = NULL, updated_at = ?
              WHERE user_id = ? AND ? = 'ignored' AND id = (
                SELECT event_id FROM ea_financial_documents WHERE user_id = ? AND id = ?
                  AND claim_token = ? AND revision = ? AND status = 'processing')`,
        args: [timestamp, claim.userId, input.status, claim.userId, claim.id, claim.claimToken, claim.revision],
      },
      {
        sql: `UPDATE ea_financial_documents SET status = ?, candidate_json = ?, content_hash = ?,
              processed_revision = CASE WHEN ? = 'ignored' THEN revision ELSE processed_revision END,
              next_attempt_at = ?, last_error = ?, claim_token = NULL, claimed_at = NULL, updated_at = ?
            WHERE user_id = ? AND id = ? AND claim_token = ? AND revision = ? AND status = 'processing'`,
        args: [input.status, input.status === "ignored" ? null : input.candidate ? writeJson(input.candidate) : null, input.contentHash,
          input.status, input.nextAttemptAt ?? null, input.error ?? null, timestamp,
          claim.userId, claim.id, claim.claimToken, claim.revision],
      },
    ], "write");
    if (!results[1]!.rowsAffected) await releaseChangedClaim("ea_financial_documents", claim);
    return results[1]!.rowsAffected === 1;
  }

  async function associateDocument(claim: FinancialDocument, input: {
    candidate: BillCandidate;
    contentHash: string;
    eventId: string;
    referenceKey?: string | null;
    nextAttemptAt?: number | null;
  }): Promise<boolean> {
    if (!input.eventId) throw new Error("A financial event identity is required");
    const timestamp = now();
    // All statements share a write transaction. The event is admitted only by
    // the current document lease, and that same lease links the document.
    const results = await dbClient.batch([
      {
        sql: `INSERT INTO ea_financial_events (id, user_id, created_at, updated_at, next_attempt_at, collection_deadline)
              SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
                SELECT 1 FROM ea_financial_documents WHERE user_id = ? AND id = ?
                  AND claim_token = ? AND revision = ? AND status = 'processing'
                  AND (event_id IS NULL OR event_id = ?))
                AND NOT EXISTS (SELECT 1 FROM ea_financial_event_references
                  WHERE user_id = ? AND reference_key = ? AND event_id <> ?)
              ON CONFLICT(id) DO UPDATE SET revision = revision + 1,
                status = CASE WHEN status = 'processing' THEN status ELSE 'pending' END,
                collection_deadline = CASE WHEN attempted_at IS NULL AND excluded.collection_deadline IS NOT NULL
                  THEN MAX(COALESCE(collection_deadline, 0), excluded.collection_deadline) ELSE collection_deadline END,
                next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at
              WHERE ea_financial_events.user_id = excluded.user_id`,
        args: [input.eventId, claim.userId, timestamp, timestamp, input.nextAttemptAt ?? null, input.nextAttemptAt ?? null,
          claim.userId, claim.id, claim.claimToken, claim.revision, input.eventId,
          claim.userId, input.referenceKey ?? null, input.eventId],
      },
      {
        sql: `INSERT INTO ea_financial_event_references (user_id, reference_key, event_id)
              SELECT ?, ?, ? WHERE ? IS NOT NULL AND EXISTS (
                SELECT 1 FROM ea_financial_documents WHERE user_id = ? AND id = ?
                  AND claim_token = ? AND revision = ? AND status = 'processing'
                  AND (event_id IS NULL OR event_id = ?))
                AND EXISTS (SELECT 1 FROM ea_financial_events WHERE user_id = ? AND id = ?)
              ON CONFLICT(user_id, reference_key) DO NOTHING`,
        args: [claim.userId, input.referenceKey ?? null, input.eventId, input.referenceKey ?? null,
          claim.userId, claim.id, claim.claimToken, claim.revision, input.eventId, claim.userId, input.eventId],
      },
      {
        sql: `UPDATE ea_financial_documents SET status = 'associated', candidate_json = ?, content_hash = ?,
                event_id = ?, processed_revision = revision, next_attempt_at = NULL, last_error = NULL,
                claim_token = NULL, claimed_at = NULL, updated_at = ?
              WHERE user_id = ? AND id = ? AND claim_token = ? AND revision = ? AND status = 'processing'
                AND (event_id IS NULL OR event_id = ?)
                AND EXISTS (SELECT 1 FROM ea_financial_events e WHERE e.user_id = ? AND e.id = ?)
                AND (? IS NULL OR EXISTS (SELECT 1 FROM ea_financial_event_references
                  WHERE user_id = ? AND reference_key = ? AND event_id = ?))`,
        args: [writeJson(input.candidate), input.contentHash, input.eventId, timestamp,
          claim.userId, claim.id, claim.claimToken, claim.revision, input.eventId, claim.userId, input.eventId,
          input.referenceKey ?? null, claim.userId, input.referenceKey ?? null, input.eventId],
      },
    ], "write");
    const linked = results[2]!.rowsAffected === 1;
    if (!linked) await releaseChangedClaim("ea_financial_documents", claim);
    return linked;
  }

  async function listDocuments(userId: string, { since, until, limit = 100 }: {
    since?: string | number; until?: string | number; limit?: number;
  } = {}): Promise<FinancialDocument[]> {
    const date = since == null ? "" : new Date(since).toISOString();
    const end = until == null ? null : new Date(until).toISOString();
    return readDocuments({
      sql: `${DOCUMENT_SELECT} WHERE d.user_id = ? AND (d.candidate_json IS NOT NULL OR owner_event.owner_completion_json IS NOT NULL)
              AND d.processed_revision = d.revision AND e.email_date_utc >= ?
              AND (? IS NULL OR e.email_date_utc <= ?)
            ORDER BY e.email_date_utc DESC, d.id DESC LIMIT ?`,
      args: [userId, date, end, end, Math.max(1, Math.min(200, Math.trunc(limit)))],
    });
  }

  async function findEventsByReference(userId: string, referenceKey: string): Promise<string[]> {
    const result = await dbClient.execute({
      sql: "SELECT event_id FROM ea_financial_event_references WHERE user_id = ? AND reference_key = ?",
      args: [userId, referenceKey],
    });
    return result.rows.map((row) => String(row.event_id));
  }

  async function completeEvent(document: FinancialDocument, event: FinancialEvent | null, input: {
    eventId: string; plan: FinancialEmailPlan; completion: FinancialOwnerCompletion; referenceKey?: string | null;
  }): Promise<boolean> {
    const timestamp = now();
    const completion = writeJson(input.completion);
    const deadline = timestamp + 90_000;
    const reference = input.referenceKey ?? null;
    const results = await dbClient.batch([
      { sql: `INSERT INTO ea_financial_events (id, user_id, created_at, updated_at)
              SELECT ?, ?, ?, ? WHERE ? IS NULL AND EXISTS (
                SELECT 1 FROM ea_financial_documents WHERE user_id = ? AND id = ? AND revision = ? AND event_id IS NULL)
              AND NOT EXISTS (SELECT 1 FROM ea_financial_event_references WHERE user_id = ? AND reference_key = ? AND event_id <> ?)
              ON CONFLICT(id) DO NOTHING`,
        args: [input.eventId, document.userId, timestamp, timestamp, event?.id ?? null,
          document.userId, document.id, document.revision, document.userId, reference, input.eventId] },
      { sql: `UPDATE ea_financial_events SET revision = revision + 1, status = 'pending', plan_json = ?,
                owner_completion_json = ?, outcome_json = NULL, reason = 'Owner-confirmed entry queued for Actual.',
                collection_deadline = MAX(COALESCE(collection_deadline, 0), ?),
                next_attempt_at = MAX(COALESCE(collection_deadline, 0), ?), attempts = 0,
                claim_token = NULL, claimed_at = NULL, updated_at = ?
              WHERE user_id = ? AND id = ? AND revision = ? AND attempted_at IS NULL AND operation_json IS NULL
                AND (owner_completion_json IS NULL OR status IN ('waiting', 'needs_review'))
                AND COALESCE(json_extract(outcome_json, '$.outcome'), '') NOT IN ('added', 'updated', 'already_present')
                AND COALESCE(json_extract(plan_json, '$.reconciliation.status'), '') NOT IN ('already_recorded', 'already_scheduled')
                AND EXISTS (SELECT 1 FROM ea_financial_documents WHERE user_id = ? AND id = ? AND revision = ? AND event_id IS ?)
                AND NOT EXISTS (SELECT 1 FROM ea_financial_event_references WHERE user_id = ? AND reference_key = ? AND event_id <> ?)`,
        args: [writeJson(input.plan), completion, deadline, deadline, timestamp,
          document.userId, input.eventId, event?.revision ?? 1, document.userId, document.id, document.revision,
          event?.id ?? null, document.userId, reference, input.eventId] },
      { sql: `INSERT INTO ea_financial_event_references (user_id, reference_key, event_id)
              SELECT ?, ?, ? WHERE ? IS NOT NULL AND EXISTS (
                SELECT 1 FROM ea_financial_events WHERE user_id = ? AND id = ? AND owner_completion_json = ?)
              ON CONFLICT(user_id, reference_key) DO NOTHING`,
        args: [document.userId, reference, input.eventId, reference, document.userId, input.eventId, completion] },
      { sql: `UPDATE ea_financial_documents SET revision = revision + 1, processed_revision = revision + 1, owner_confirmation_conflict = 0,
                status = 'associated', event_id = ?, next_attempt_at = NULL, last_error = NULL,
                content_hash = (SELECT json_extract(value, '$.contentHash') FROM json_each(?, '$.documents')
                  WHERE json_extract(value, '$.emailUid') = ea_financial_documents.email_uid),
                claim_token = NULL, claimed_at = NULL, updated_at = ?
              WHERE user_id = ? AND (event_id = ? OR id = ?) AND EXISTS (
                SELECT 1 FROM ea_financial_events WHERE user_id = ? AND id = ? AND owner_completion_json = ?)`,
        args: [input.eventId, completion, timestamp, document.userId, input.eventId, document.id,
          document.userId, input.eventId, completion] },
    ], "write");
    return results[1]!.rowsAffected === 1;
  }

  async function acknowledgeOwnerCompletedDocument(claim: FinancialDocument, contentHash: string, referenceKey?: string | null): Promise<boolean> {
    const results = await dbClient.batch([
      { sql: `INSERT INTO ea_financial_event_references (user_id, reference_key, event_id)
              SELECT user_id, ?, event_id FROM ea_financial_documents
              WHERE user_id = ? AND id = ? AND revision = ? AND claim_token = ? AND status = 'processing'
                AND ? IS NOT NULL AND EXISTS (SELECT 1 FROM ea_financial_events WHERE user_id = ?
                  AND id = ea_financial_documents.event_id AND owner_completion_json IS NOT NULL)
              ON CONFLICT(user_id, reference_key) DO NOTHING`,
        args: [referenceKey ?? null, claim.userId, claim.id, claim.revision, claim.claimToken, referenceKey ?? null, claim.userId] },
      {
      sql: `UPDATE ea_financial_documents SET status = 'associated', processed_revision = revision,
              content_hash = ?, next_attempt_at = NULL,
              owner_confirmation_conflict = CASE WHEN (content_hash IS NOT NULL AND content_hash <> ?)
                OR EXISTS (SELECT 1 FROM ea_financial_event_references WHERE user_id = ?
                  AND reference_key = ? AND event_id <> ea_financial_documents.event_id)
                THEN 1 ELSE owner_confirmation_conflict END,
              last_error = CASE WHEN EXISTS (SELECT 1 FROM ea_financial_event_references WHERE user_id = ?
                AND reference_key = ? AND event_id <> ea_financial_documents.event_id)
                THEN 'Grounded reference is already linked to another financial event.'
                WHEN last_error IN ('Grounded reference is already linked to another financial event.',
                  'Source content changed after owner confirmation.') THEN last_error
                WHEN content_hash IS NOT NULL AND content_hash <> ?
                  THEN 'Source content changed after owner confirmation.' ELSE NULL END,
              claim_token = NULL, claimed_at = NULL, updated_at = ?
            WHERE user_id = ? AND id = ? AND revision = ? AND claim_token = ? AND status = 'processing'
              AND EXISTS (SELECT 1 FROM ea_financial_events WHERE user_id = ? AND id = ea_financial_documents.event_id
                AND owner_completion_json IS NOT NULL)`,
      args: [contentHash, contentHash, claim.userId, referenceKey ?? null,
        claim.userId, referenceKey ?? null, contentHash, now(), claim.userId, claim.id, claim.revision, claim.claimToken, claim.userId],
      },
    ], "write");
    if (!results[1]!.rowsAffected) await releaseChangedClaim("ea_financial_documents", claim);
    return results[1]!.rowsAffected === 1;
  }

  async function projectEvent(row: Row): Promise<FinancialEvent> {
    return eventFromRow(row, await readDocuments({
      sql: `${DOCUMENT_SELECT} WHERE d.user_id = ? AND d.event_id = ? ORDER BY e.email_date_utc, d.id`,
      args: [row.user_id!, row.id!],
    }));
  }

  async function claimEvent(claimToken: string): Promise<FinancialEvent | null> {
    if (!claimToken) throw new Error("A financial event claim token is required");
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `UPDATE ea_financial_events SET status = 'processing', claim_token = ?, claimed_at = ?,
              attempts = attempts + 1, updated_at = ?
            WHERE id = (SELECT id FROM ea_financial_events WHERE ${READY_EVENT}
              ORDER BY created_at, id LIMIT 1) AND status IN ('pending', 'waiting') RETURNING *`,
      args: [claimToken, timestamp, timestamp, timestamp],
    });
    return result.rows[0] ? projectEvent(result.rows[0]) : null;
  }

  async function saveEvent(claim: FinancialEvent, input: {
    plan: FinancialEmailPlan | null;
    status: Exclude<EventStatus, "processing">;
    nextAttemptAt?: number | null;
    reason?: string | null;
    outcome?: unknown;
  }): Promise<boolean> {
    const result = await dbClient.execute({
      sql: `UPDATE ea_financial_events SET status = ?, plan_json = ?, next_attempt_at = ?, reason = ?,
              outcome_json = CASE WHEN ? THEN ? ELSE outcome_json END,
              claim_token = NULL, claimed_at = NULL, updated_at = ?
            WHERE user_id = ? AND id = ? AND claim_token = ? AND revision = ? AND status = 'processing'`,
      args: [input.status, input.plan ? writeJson(input.plan) : null, input.nextAttemptAt ?? null,
        input.reason ?? null, input.outcome === undefined ? 0 : 1,
        input.outcome === undefined ? null : writeJson(input.outcome), now(),
        claim.userId, claim.id, claim.claimToken, claim.revision],
    });
    if (!result.rowsAffected) await releaseChangedClaim("ea_financial_events", claim);
    return result.rowsAffected === 1;
  }

  async function admitOperation(claim: FinancialEvent, operation: unknown, plan?: FinancialEmailPlan): Promise<boolean> {
    if (operation == null) throw new Error("A financial operation payload is required");
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `UPDATE ea_financial_events SET operation_json = ?, attempted_at = ?, updated_at = ?,
              plan_json = COALESCE(?, plan_json)
            WHERE user_id = ? AND id = ? AND claim_token = ? AND revision = ? AND status = 'processing'
              AND attempted_at IS NULL AND operation_json IS NULL
              AND ${INTAKE_COMPLETE}
              AND NOT EXISTS (SELECT 1 FROM ea_financial_documents d
                WHERE d.user_id = ea_financial_events.user_id AND d.event_id = ea_financial_events.id
                  AND d.processed_revision < d.revision)
              AND NOT EXISTS (SELECT 1 FROM ea_financial_documents arrival
                WHERE arrival.user_id = ea_financial_events.user_id AND arrival.status IN ('pending', 'processing'))`,
      args: [writeJson(operation), timestamp, timestamp, plan ? writeJson(plan) : null,
        claim.userId, claim.id, claim.claimToken, claim.revision],
    });
    return result.rowsAffected === 1;
  }

  async function recoverStaleClaims(staleBefore = now() - CLAIM_LEASE_MS): Promise<{ documents: number; events: number }> {
    const timestamp = now();
    const result = await dbClient.batch([
      { sql: `UPDATE ea_financial_documents SET status = 'retry', claim_token = NULL, claimed_at = NULL,
                next_attempt_at = ?, last_error = 'Financial document processing was interrupted', updated_at = ?
              WHERE status = 'processing' AND claimed_at <= ?`, args: [timestamp, timestamp, staleBefore] },
      { sql: `UPDATE ea_financial_events SET status = 'pending', claim_token = NULL, claimed_at = NULL,
                next_attempt_at = ?, reason = 'Financial event processing was interrupted', updated_at = ?
              WHERE status = 'processing' AND claimed_at <= ?`, args: [timestamp, timestamp, staleBefore] },
    ], "write");
    return { documents: result[0]!.rowsAffected, events: result[1]!.rowsAffected };
  }

  async function getNextWakeAt(): Promise<number | null> {
    const timestamp = now();
    const result = await dbClient.execute({
      sql: `SELECT MIN(wake_at) AS wake_at FROM (
              SELECT MIN(COALESCE(next.next_attempt_at, ?)) AS wake_at FROM ea_financial_documents next
                WHERE next.status IN ('pending', 'retry') AND NOT EXISTS (
                  SELECT 1 FROM ea_financial_documents busy WHERE busy.user_id = next.user_id AND busy.status = 'processing')
              UNION ALL SELECT MIN(COALESCE(next_attempt_at, ?)) FROM ea_financial_events
                WHERE status IN ('pending', 'waiting') AND ${INTAKE_COMPLETE} AND NOT EXISTS (
                  SELECT 1 FROM ea_financial_documents d WHERE d.user_id = ea_financial_events.user_id
                    AND d.event_id = ea_financial_events.id AND d.processed_revision < d.revision)
                  AND (attempted_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ea_financial_documents arrival
                    WHERE arrival.user_id = ea_financial_events.user_id AND arrival.status IN ('pending', 'processing'))))`,
      args: [timestamp, timestamp],
    });
    return nullableNumber(result.rows[0]?.wake_at);
  }

  async function isManagedEmail(userId: string, uid: string): Promise<boolean> {
    return (await readManagedFinancialEmailUids(userId, [uid], dbClient)).length > 0;
  }

  async function getDocumentForEmail(userId: string, uid: string): Promise<FinancialDocument | null> {
    return (await readDocuments({
      sql: `${DOCUMENT_SELECT} WHERE d.user_id = ? AND d.email_uid = ?`, args: [userId, uid],
    }))[0] || null;
  }

  async function getEventForEmail(userId: string, uid: string): Promise<FinancialEvent | null> {
    const result = await dbClient.execute({
      sql: `SELECT e.* FROM ea_financial_events e JOIN ea_financial_documents d
              ON d.user_id = e.user_id AND d.event_id = e.id WHERE d.user_id = ? AND d.email_uid = ?`,
      args: [userId, uid],
    });
    return result.rows[0] ? projectEvent(result.rows[0]) : null;
  }

  return { claimDocument, settleDocument, associateDocument, listDocuments, findEventsByReference, completeEvent,
    acknowledgeOwnerCompletedDocument, claimEvent, saveEvent,
    admitOperation, recoverStaleClaims, getNextWakeAt, isManagedEmail, getDocumentForEmail, getEventForEmail };
}

export const financialEventStore = createFinancialEventStore();
export type FinancialEventStore = ReturnType<typeof createFinancialEventStore>;
