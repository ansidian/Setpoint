import crypto from "crypto";
import db from "../db/connection.js";
import {
  assertReminderShape,
  computeRemindAt,
} from "./reminder-model.js";

function client(options = {}) {
  return options.dbClient || db;
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_snapshot: parseJson(row.payload_snapshot_json),
  };
}

function sourceWhere({ sourceType, sourceItemId, sourceOccurrenceId }) {
  const args = [sourceType, sourceItemId];
  let sql = "source_type = ? AND source_item_id = ?";
  if (sourceOccurrenceId !== undefined) {
    sql += " AND source_occurrence_id IS ?";
    args.push(sourceOccurrenceId);
  }
  return { sql, args };
}

export function reminderSourceKey({ sourceType, sourceItemId, sourceOccurrenceId = null }) {
  return `${sourceType}:${sourceItemId}:${sourceOccurrenceId || ""}`;
}

function emptyUpcomingState() {
  return {
    hasUpcomingReminder: false,
    upcomingCount: 0,
    nextReminderAt: null,
  };
}

const UPCOMING_REMINDER_SOURCE_BATCH_SIZE = 250;

export async function createReminder(input, options = {}) {
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

  return getReminderById(id, { dbClient });
}

export async function getReminderById(id, options = {}) {
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
}, options = {}) {
  const where = sourceWhere({ sourceType, sourceItemId, sourceOccurrenceId });
  const result = await client(options).execute({
    sql: `SELECT * FROM ea_reminders
          WHERE user_id = ? AND ${where.sql}
          ORDER BY remind_at ASC, created_at ASC`,
    args: [userId, ...where.args],
  });
  return result.rows.map(normalizeRow);
}

export async function listUpcomingReminderStatesForSources({
  userId,
  sources = [],
  now = new Date(),
}, options = {}) {
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
    const args = [userId, nowIso];
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
        sourceType: row.source_type,
        sourceItemId: row.source_item_id,
        sourceOccurrenceId: row.source_occurrence_id || null,
      });
      const current = stateByKey.get(key) || emptyUpcomingState();
      stateByKey.set(key, {
        hasUpcomingReminder: true,
        upcomingCount: current.upcomingCount + 1,
        nextReminderAt: current.nextReminderAt || row.remind_at,
      });
    }
  }

  return stateByKey;
}

export async function deleteReminder(userId, id, options = {}) {
  const result = await client(options).execute({
    sql: "DELETE FROM ea_reminders WHERE user_id = ? AND id = ?",
    args: [userId, id],
  });
  return Number(result.rowsAffected || 0) > 0;
}

export async function deleteSourceReminders({
  userId,
  sourceType,
  sourceItemId,
  sourceOccurrenceId,
  unsentOnly = false,
}, options = {}) {
  const where = sourceWhere({ sourceType, sourceItemId, sourceOccurrenceId });
  const statusSql = unsentOnly ? " AND status = 'pending'" : "";
  const result = await client(options).execute({
    sql: `DELETE FROM ea_reminders
          WHERE user_id = ? AND ${where.sql}${statusSql}`,
    args: [userId, ...where.args],
  });
  return Number(result.rowsAffected || 0);
}

export async function recomputeUnsentRemindersForSource({
  userId,
  sourceType,
  sourceItemId,
  sourceOccurrenceId,
  anchorAt,
  anchorKind,
  now = new Date(),
}, options = {}) {
  assertReminderShape({ sourceType, anchorKind });
  const reminders = await listRemindersForSource({
    userId,
    sourceType,
    sourceItemId,
    sourceOccurrenceId,
  }, options);
  const pending = reminders.filter((reminder) => reminder.status === "pending");
  const dbClient = client(options);
  const nowMs = new Date(options.now || now).getTime();

  for (const reminder of pending) {
    const nextRemindAt = computeRemindAt(anchorAt, reminder.offset_minutes);
    if (Number.isFinite(nowMs) && new Date(nextRemindAt).getTime() <= nowMs) {
      await dbClient.execute({
        sql: "DELETE FROM ea_reminders WHERE id = ?",
        args: [reminder.id],
      });
      continue;
    }
    await dbClient.execute({
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
    });
  }

  return pending.length;
}

export async function listDueReminders({
  now = new Date(),
  limit = 25,
} = {}, options = {}) {
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
  return result.rows.map(normalizeRow);
}

export async function markReminderSent(id, { sentAt = new Date() } = {}, options = {}) {
  await client(options).execute({
    sql: `UPDATE ea_reminders
          SET status = 'sent',
              sent_at = ?,
              retry_after = NULL,
              last_error = NULL,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [new Date(sentAt).toISOString(), id],
  });
}

export async function markReminderMissed(id, { missedAt = new Date() } = {}, options = {}) {
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

export async function markReminderDeliveryFailed(id, {
  error,
  retryAfter = null,
} = {}, options = {}) {
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
