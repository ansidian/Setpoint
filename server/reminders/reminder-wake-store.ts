import type { Client } from "@libsql/client";
import type { Reminder } from "../../shared/types/reminders.ts";
import db from "../db/connection.ts";

export function earliestReminderWakeAt(reminder: Reminder): number {
  return Math.min(
    ...[reminder.next_route_check_at, reminder.remind_at, reminder.anchor_at]
      .filter((value): value is string => !!value)
      .map((value) => Date.parse(value)),
  );
}

export async function getNextReminderWakeAt({
  dbClient = db,
}: { dbClient?: Client } = {}): Promise<number | null> {
  const result = await dbClient.execute({
    sql: `SELECT MIN(wake_at) AS next_wake_at
          FROM (
            SELECT CASE
                     WHEN retry_after IS NOT NULL AND retry_after > remind_at THEN retry_after
                     ELSE remind_at
                   END AS wake_at
            FROM ea_reminders
            WHERE status = 'pending' AND reminder_kind = 'fixed'
            UNION ALL
            SELECT next_route_check_at AS wake_at
            FROM ea_reminders
            WHERE status = 'pending'
              AND reminder_kind = 'time_to_leave'
              AND next_route_check_at IS NOT NULL
            UNION ALL
            SELECT CASE
                     WHEN retry_after IS NOT NULL AND retry_after > remind_at THEN retry_after
                     ELSE remind_at
                   END AS wake_at
            FROM ea_reminders
            WHERE status = 'pending'
              AND reminder_kind = 'time_to_leave'
              AND route_status IN ('ready', 'degraded')
            UNION ALL
            SELECT anchor_at AS wake_at
            FROM ea_reminders
            WHERE status = 'pending' AND reminder_kind = 'time_to_leave'
          )`,
    args: [],
  });
  const value = result.rows[0]?.next_wake_at;
  if (value == null) return null;
  const wakeAt = Date.parse(String(value));
  return Number.isFinite(wakeAt) ? wakeAt : null;
}
