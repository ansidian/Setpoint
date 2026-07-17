import crypto from "crypto";
import type { Client, InStatement, InValue, Row } from "@libsql/client";
import db from "../db/connection.ts";
import {
  assertReminderShape,
  computeRemindAt,
} from "./reminder-model.ts";
import type {
  CreateReminderInput,
  Reminder,
  ReminderAnchorKind,
  ReminderId,
  ReminderPayloadSnapshot,
  ReminderSourceIdentity,
  ReminderSourceType,
  ReminderStatus,
  UpcomingReminderState,
} from "../../shared/types/reminders.ts";

type DateInput = string | number | Date;
interface ReminderServiceOptions {
  dbClient?: Client;
  idFactory?: () => string;
  now?: DateInput;
  collect?: boolean;
}
interface SourceRequest extends ReminderSourceIdentity { userId: string }
interface RecomputeRequest extends SourceRequest {
  anchorAt: string;
  anchorKind: ReminderAnchorKind;
  now?: DateInput;
}
type DeleteSourceRequest = SourceRequest & { unsentOnly?: boolean };
type CollectReminderServiceOptions = ReminderServiceOptions & { collect: true };
type ExecuteReminderServiceOptions = ReminderServiceOptions & { collect?: false };

function client(options: ReminderServiceOptions = {}): Client {
  return options.dbClient || db;
}

function parseJson(value: unknown): ReminderPayloadSnapshot | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as ReminderPayloadSnapshot
      : null;
  } catch {
    return null;
  }
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function normalizeRow(row: Row | undefined | null): Reminder | null {
  if (!row) return null;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    source_type: String(row.source_type) as ReminderSourceType,
    source_account_id: nullableString(row.source_account_id),
    source_calendar_id: nullableString(row.source_calendar_id),
    source_item_id: String(row.source_item_id),
    source_occurrence_id: nullableString(row.source_occurrence_id),
    anchor_kind: String(row.anchor_kind) as ReminderAnchorKind,
    anchor_at: String(row.anchor_at),
    offset_minutes: Number(row.offset_minutes),
    remind_at: String(row.remind_at),
    status: String(row.status) as ReminderStatus,
    sent_at: nullableString(row.sent_at),
    missed_at: nullableString(row.missed_at),
    retry_count: Number(row.retry_count),
    retry_after: nullableString(row.retry_after),
    last_error: nullableString(row.last_error),
    payload_snapshot_json: nullableString(row.payload_snapshot_json),
    payload_snapshot: parseJson(row.payload_snapshot_json),
    created_at: nullableString(row.created_at),
    updated_at: nullableString(row.updated_at),
  };
}

function sourceWhere({ sourceType, sourceItemId, sourceOccurrenceId }: ReminderSourceIdentity): { sql: string; args: InValue[] } {
  const args: InValue[] = [sourceType, sourceItemId];
  let sql = "source_type = ? AND source_item_id = ?";
  if (sourceOccurrenceId !== undefined) {
    sql += " AND source_occurrence_id IS ?";
    args.push(sourceOccurrenceId);
  }
  return { sql, args };
}

export function reminderSourceKey({ sourceType, sourceItemId, sourceOccurrenceId = null }: ReminderSourceIdentity): string {
  return `${sourceType}:${sourceItemId}:${sourceOccurrenceId || ""}`;
}

function emptyUpcomingState(): UpcomingReminderState {
  return {
    hasUpcomingReminder: false,
    upcomingCount: 0,
    nextReminderAt: null,
  };
}

const UPCOMING_REMINDER_SOURCE_BATCH_SIZE = 50;

export async function createReminder(input: CreateReminderInput, options: ReminderServiceOptions = {}): Promise<Reminder> {
  const dbClient = client(options);
  const id = options.idFactory?.() || crypto.randomUUID();
  const anchorKind = input.anchorKind;
  const sourceType = input.sourceType;
  assertReminderShape({ sourceType, anchorKind });
  const remindAt = computeRemindAt(input.anchorAt, input.offsetMinutes);

  await dbClient.execute({
    sql: `INSERT INTO ea_reminders
            (id, user_id, source_type, source_account_id, source_calendar_id,
             source_item_id, source_occurrence_id, anchor_kind, anchor_at,
             offset_minutes, remind_at, payload_snapshot_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.userId,
      sourceType,
      input.sourceAccountId || null,
      input.sourceCalendarId || null,
      input.sourceItemId,
      input.sourceOccurrenceId || null,
      anchorKind,
      new Date(input.anchorAt).toISOString(),
      Number(input.offsetMinutes),
      remindAt,
      input.payloadSnapshot ? JSON.stringify(input.payloadSnapshot) : null,
    ],
  });

  return (await getReminderById(id, { dbClient }))!;
}

export async function getReminderById(id: ReminderId, options: ReminderServiceOptions = {}): Promise<Reminder | null> {
  const result = await client(options).execute({
    sql: "SELECT * FROM ea_reminders WHERE id = ?",
    args: [id],
  });
  return normalizeRow(result.rows[0] || null);
}

export async function listRemindersForSource({
  userId,
  sourceType,
  sourceItemId,
  sourceOccurrenceId,
}: SourceRequest, options: ReminderServiceOptions = {}): Promise<Reminder[]> {
  const where = sourceWhere({ sourceType, sourceItemId, sourceOccurrenceId });
  const result = await client(options).execute({
    sql: `SELECT * FROM ea_reminders
          WHERE user_id = ? AND ${where.sql}
          ORDER BY remind_at ASC, created_at ASC`,
    args: [userId, ...where.args],
  });
  return result.rows.map((row) => normalizeRow(row)!);
}

export async function listUpcomingReminderStatesForSources({
  userId,
  sources = [],
  now = new Date(),
}: { userId: string; sources?: ReminderSourceIdentity[]; now?: DateInput }, options: ReminderServiceOptions = {}): Promise<Map<string, UpcomingReminderState>> {
  const normalizedSources = (sources || [])
    .filter((source) => source?.sourceType && source?.sourceItemId)
    .map((source) => ({
      sourceType: source.sourceType,
      sourceItemId: String(source.sourceItemId),
      sourceOccurrenceId: source.sourceOccurrenceId || null,
    }));
  const stateByKey = new Map(normalizedSources.map((source) => [
    reminderSourceKey(source),
    emptyUpcomingState(),
  ]));
  if (!normalizedSources.length) return stateByKey;

  const dbClient = client(options);
  const nowIso = new Date(now).toISOString();
  for (let index = 0; index < normalizedSources.length; index += UPCOMING_REMINDER_SOURCE_BATCH_SIZE) {
    const batch = normalizedSources.slice(index, index + UPCOMING_REMINDER_SOURCE_BATCH_SIZE);
    const clauses = [];
    const args: InValue[] = [userId, nowIso];
    for (const source of batch) {
      clauses.push("(source_type = ? AND source_item_id = ? AND source_occurrence_id IS ?)");
      args.push(source.sourceType, source.sourceItemId, source.sourceOccurrenceId);
    }

    const result = await dbClient.execute({
      sql: `SELECT source_type, source_item_id, source_occurrence_id, remind_at
            FROM ea_reminders
            WHERE user_id = ?
              AND status = 'pending'
              AND remind_at > ?
              AND (${clauses.join(" OR ")})
            ORDER BY remind_at ASC`,
      args,
    });

    for (const row of result.rows) {
      const key = reminderSourceKey({
        sourceType: String(row.source_type) as ReminderSourceType,
        sourceItemId: String(row.source_item_id),
        sourceOccurrenceId: row.source_occurrence_id == null ? null : String(row.source_occurrence_id),
      });
      const current = stateByKey.get(key) || emptyUpcomingState();
      stateByKey.set(key, {
        hasUpcomingReminder: true,
        upcomingCount: current.upcomingCount + 1,
        nextReminderAt: current.nextReminderAt || String(row.remind_at),
      });
    }
  }

  return stateByKey;
}

export async function deleteReminder(userId: string, id: ReminderId, options: ReminderServiceOptions = {}): Promise<boolean> {
  const result = await client(options).execute({
    sql: "DELETE FROM ea_reminders WHERE user_id = ? AND id = ?",
    args: [userId, id],
  });
  return Number(result.rowsAffected || 0) > 0;
}

export function deleteSourceReminders(input: DeleteSourceRequest, options: CollectReminderServiceOptions): Promise<InStatement>;
export function deleteSourceReminders(input: DeleteSourceRequest, options?: ExecuteReminderServiceOptions): Promise<number>;
export async function deleteSourceReminders({
  userId,
  sourceType,
  sourceItemId,
  sourceOccurrenceId,
  unsentOnly = false,
}: DeleteSourceRequest, options: ReminderServiceOptions = {}): Promise<number | InStatement> {
  const where = sourceWhere({ sourceType, sourceItemId, sourceOccurrenceId });
  const statusSql = unsentOnly ? " AND status = 'pending'" : "";
  const statement = {
    sql: `DELETE FROM ea_reminders
          WHERE user_id = ? AND ${where.sql}${statusSql}`,
    args: [userId, ...where.args],
  };
  // P2-21: in collect mode return the DELETE statement so a caller can fold it
  // into a larger batched transaction instead of executing it standalone.
  if (options.collect) return statement;
  const result = await client(options).execute(statement);
  return Number(result.rowsAffected || 0);
}

export function recomputeUnsentRemindersForSource(input: RecomputeRequest, options: CollectReminderServiceOptions): Promise<InStatement[]>;
export function recomputeUnsentRemindersForSource(input: RecomputeRequest, options?: ExecuteReminderServiceOptions): Promise<number>;
export async function recomputeUnsentRemindersForSource({
  userId,
  sourceType,
  sourceItemId,
  sourceOccurrenceId,
  anchorAt,
  anchorKind,
  now = new Date(),
}: RecomputeRequest, options: ReminderServiceOptions = {}): Promise<number | InStatement[]> {
  assertReminderShape({ sourceType, anchorKind });
  const reminders = await listRemindersForSource({
    userId,
    sourceType,
    sourceItemId,
    sourceOccurrenceId,
  }, options);
  const pending = reminders.filter((reminder) => reminder.status === "pending");
  const nowMs = new Date(options.now || now).getTime();

  // Build the per-reminder mutations as pure data first (computeRemindAt is pure),
  // so collect mode can return them and non-collect mode can execute them.
  const statements = pending.map((reminder) => {
    const nextRemindAt = computeRemindAt(anchorAt, reminder.offset_minutes);
    if (Number.isFinite(nowMs) && new Date(nextRemindAt).getTime() <= nowMs) {
      return {
        sql: "DELETE FROM ea_reminders WHERE id = ?",
        args: [reminder.id],
      };
    }
    return {
      sql: `UPDATE ea_reminders
            SET anchor_kind = ?,
                anchor_at = ?,
                remind_at = ?,
                retry_after = NULL,
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [
        anchorKind,
        new Date(anchorAt).toISOString(),
        nextRemindAt,
        reminder.id,
      ],
    };
  });

  // P2-21: return the statements so the caller (Todoist mirror reconcile) can
  // fold them into the same batched transaction as the item upserts.
  if (options.collect) return statements;

  const dbClient = client(options);
  for (const statement of statements) {
    await dbClient.execute(statement);
  }
  return pending.length;
}

export async function listDueReminders({
  now = new Date(),
  limit = 25,
}: { now?: DateInput; limit?: number } = {}, options: ReminderServiceOptions = {}): Promise<Reminder[]> {
  const nowIso = new Date(now).toISOString();
  const result = await client(options).execute({
    sql: `SELECT * FROM ea_reminders
          WHERE status = 'pending'
            AND remind_at <= ?
            AND (retry_after IS NULL OR retry_after <= ?)
          ORDER BY remind_at ASC
          LIMIT ?`,
    args: [nowIso, nowIso, limit],
  });
  return result.rows.map((row) => normalizeRow(row)!);
}

// P3-45: atomic delivery claim. The `AND status = 'pending'` guard is the durable
// (DB-level) protection against the same reminder being marked sent twice — e.g. a
// stale/duplicate processor re-marking an already-sent row. The in-process
// single-flight flag in server/scheduler.ts (reminderSchedulerInFlight) only guards
// one process; this conditional UPDATE is the real guard. Mirrors the
// claim-on-condition + gate-on-rowsAffected pattern from claimNextEmailTriageJob.
// Returns true iff this call won the claim (1 row updated).
export async function markReminderSent(id: ReminderId, { sentAt = new Date() }: { sentAt?: DateInput } = {}, options: ReminderServiceOptions = {}): Promise<boolean> {
  const result = await client(options).execute({
    sql: `UPDATE ea_reminders
          SET status = 'sent',
              sent_at = ?,
              retry_after = NULL,
              last_error = NULL,
              updated_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
    args: [new Date(sentAt).toISOString(), id],
  });
  return Number(result.rowsAffected || 0) === 1;
}

export async function markReminderMissed(id: ReminderId, { missedAt = new Date() }: { missedAt?: DateInput } = {}, options: ReminderServiceOptions = {}): Promise<void> {
  await client(options).execute({
    sql: `UPDATE ea_reminders
          SET status = 'missed',
              missed_at = ?,
              retry_after = NULL,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [new Date(missedAt).toISOString(), id],
  });
}

export async function markReminderDeliveryFailed(id: ReminderId, {
  error,
  retryAfter = null,
}: { error?: unknown; retryAfter?: DateInput | null } = {}, options: ReminderServiceOptions = {}): Promise<void> {
  await client(options).execute({
    sql: `UPDATE ea_reminders
          SET retry_count = retry_count + 1,
              retry_after = ?,
              last_error = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [
      retryAfter ? new Date(retryAfter).toISOString() : null,
      String(error || "Discord delivery failed").slice(0, 500),
      id,
    ],
  });
}
