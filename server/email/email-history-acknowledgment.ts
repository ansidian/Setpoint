import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";

interface AcknowledgmentInput {
  userId: string;
  jobIds: number[];
  reason: string;
  /** Omit for a read-only preview. Apply requires the preview's fingerprint. */
  expectedRevision?: string;
}

/** Operator-only disposition of exact failures, never provider work or recovery. */
export async function acknowledgeEmailHistoryFailures(
  { userId, jobIds, reason, expectedRevision }: AcknowledgmentInput,
  { dbClient, now = new Date() }: { dbClient: Client; now?: Date },
) {
  const ids = [...new Set(jobIds)].sort((a, b) => a - b);
  const note = reason.trim();
  if (!userId.trim() || !ids.length || ids.length > 100 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("Provide an owner and 1–100 exact positive job IDs.");
  }
  if (!note || note.length > 2000) throw new Error("Provide an acknowledgment reason of 1–2000 characters.");
  if (expectedRevision !== undefined && !/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error("A valid preview fingerprint is required to apply.");
  const apply = expectedRevision !== undefined;
  const tx = await dbClient.transaction(apply ? "write" : "read");
  try {
    const result = await tx.execute({
      sql: `SELECT j.*, a.email AS account_email FROM ea_triage_jobs j
            JOIN ea_accounts a ON a.id = j.account_id AND a.user_id = j.user_id
            WHERE j.user_id = ? AND j.id IN (${ids.map(() => "?").join(",")})
              AND j.job_type = 'gmail_history_sync' AND a.type = 'gmail'
            ORDER BY j.id`,
      args: [userId, ...ids],
    });
    const rows = result.rows;
    if (rows.length !== ids.length || rows.some((row) => row.status !== "failed" && row.status !== "acknowledged")) {
      throw new Error("Every selected job must be a failed Gmail history job belonging to this owner.");
    }
    const alreadyAcknowledged = rows.every((row) => row.status === "acknowledged" && row.acknowledgment_reason === note && row.acknowledged_at);
    if (!alreadyAcknowledged && rows.some((row) => row.status === "acknowledged")) {
      throw new Error("Selection contains a previously acknowledged job; its acknowledgment cannot be rewritten.");
    }
    const revision = createHash("sha256").update(JSON.stringify({ userId, reason: note, rows })).digest("hex");
    if (apply && !alreadyAcknowledged) {
      if (revision !== expectedRevision) throw new Error("Jobs changed since preview. Run a new dry run before applying.");
      // The write transaction holds the validated snapshot through settlement.
      // Validate the whole selection before updating any job; failure rolls back all.
      for (const row of rows) {
        const updated = await tx.execute({
          sql: `UPDATE ea_triage_jobs SET status = 'acknowledged', acknowledged_at = ?, acknowledgment_reason = ?
                WHERE id = ? AND user_id = ? AND account_id = ? AND job_type = 'gmail_history_sync' AND status = 'failed'`,
          args: [now.toISOString(), note, Number(row.id), userId, String(row.account_id)],
        });
        if (updated.rowsAffected !== 1) throw new Error("Job changed during acknowledgment.");
      }
    }
    await tx.commit();
    return {
      mode: apply ? "applied" : "dry-run",
      alreadyAcknowledged,
      revision,
      reason: note,
      jobs: rows.map((row) => ({
        id: Number(row.id), account: String(row.account_email),
        status: apply ? "acknowledged" : String(row.status),
        failedAt: String(row.updated_at), error: String(row.last_error),
        acknowledgedAt: row.acknowledged_at || (apply ? now.toISOString() : null),
      })),
    };
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    tx.close();
  }
}
