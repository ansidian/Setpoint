import {
  ARRIVAL_GRACE_SOURCE,
  arrivalGraceDeadline as snapshotArrivalGraceDeadline,
} from "../snapshots/arrival-grace.ts";
export const arrivalGraceDeadline = snapshotArrivalGraceDeadline;

// Pure triage statement builder lifted from gmail-sync.js: (userId, accountId,
// email, opts) -> [triage-row INSERT OR IGNORE, triage-job INSERT] statement pair.
// Owns the arrival-grace branch (source + scheduled_for + payload metadata).

export function triageStatementsForEmail(userId, accountId, email, {
  arrivalGrace = false,
  now = new Date(),
} = {}) {
  const idempotencyKey = `email_triage:${userId}:${accountId}:${email.uid}`;
  const scheduledFor = arrivalGrace ? arrivalGraceDeadline(now) : null;
  const payload = JSON.stringify({
    uid: email.uid,
    subject: email.subject || "",
    ...(arrivalGrace
      ? {
          arrivalGrace: true,
          queuedAt: now.toISOString(),
          graceDeadline: scheduledFor,
        }
      : {}),
  });
  return [
    {
      sql: `INSERT OR IGNORE INTO ea_email_triage
              (user_id, account_id, email_id, triage_status, triage_source)
            VALUES (?, ?, ?, 'pending', ?)`,
      args: [userId, accountId, email.uid, arrivalGrace ? ARRIVAL_GRACE_SOURCE : "unknown"],
    },
    {
      sql: `INSERT INTO ea_triage_jobs
              (user_id, account_id, email_id, job_type, idempotency_key,
               priority, payload_json, scheduled_for)
            VALUES (?, ?, ?, 'email_triage', ?, 2, ?, ?)
            ON CONFLICT(idempotency_key) DO NOTHING`,
      args: [userId, accountId, email.uid, idempotencyKey, payload, scheduledFor],
    },
  ];
}
