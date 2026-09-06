import db from "../db/connection.ts";
import { attachArrivalGraceEmailToActiveSnapshot, attachResurfacedSnoozeToActiveSnapshot, requeueArrivalGraceTriageForEmail, requeueEmailTriageForEmail } from "./snapshot-service.ts";
import { ARRIVAL_GRACE_SOURCE } from "./arrival-grace.ts";
import type { SnapshotEmailSource, SnapshotWriteDb } from "./snapshot-types.ts";

interface TriageRow extends Record<string, unknown> {
  triage_status?: string | null;
  triage_source?: string | null;
  last_triaged_at?: string | null;
  decision_metadata_json?: string | null;
}
interface SnoozedPendingMetadata { snoozedPending?: { previousTriageSource?: string }; }

// Shared durable restoration for scheduled wake and the owner's early return.
export async function restoreSnoozedEmail(userId: string, uid: string, snap: SnapshotEmailSource, {
  dbClient = db,
  now = new Date(),
  triageRow: loadedTriage,
  attachResurfacedSnoozeToActiveSnapshotFn = attachResurfacedSnoozeToActiveSnapshot,
  attachArrivalGraceEmailToActiveSnapshotFn = attachArrivalGraceEmailToActiveSnapshot,
  requeueArrivalGraceTriageForEmailFn = requeueArrivalGraceTriageForEmail,
  requeueEmailTriageForEmailFn = requeueEmailTriageForEmail,
}: {
  dbClient?: SnapshotWriteDb;
  now?: Date;
  triageRow?: TriageRow | null;
  attachResurfacedSnoozeToActiveSnapshotFn?: typeof attachResurfacedSnoozeToActiveSnapshot;
  attachArrivalGraceEmailToActiveSnapshotFn?: typeof attachArrivalGraceEmailToActiveSnapshot;
  requeueArrivalGraceTriageForEmailFn?: typeof requeueArrivalGraceTriageForEmail;
  requeueEmailTriageForEmailFn?: typeof requeueEmailTriageForEmail;
} = {}): Promise<void> {
  const accountId = String(snap.account_id || snap.accountId || snap._accountKey || "");
  if (!accountId) throw new Error("The snoozed message's account is unavailable");
  const resurfacedAt = now.getTime();
  const triageRow = loadedTriage !== undefined ? loadedTriage : (await dbClient.execute({
    sql: "SELECT triage_status, triage_source, last_triaged_at, decision_metadata_json FROM ea_email_triage WHERE user_id = ? AND account_id = ? AND email_id = ?",
    args: [userId, accountId, uid],
  })).rows[0] as TriageRow | undefined;
  const pendingTriage = triageRow?.triage_status === "pending";
  const completedTriage = triageRow?.triage_status === "complete"
    && Boolean(triageRow?.last_triaged_at);
  let metadata: SnoozedPendingMetadata = {};
  try {
    metadata = triageRow?.decision_metadata_json
      ? JSON.parse(triageRow.decision_metadata_json) as SnoozedPendingMetadata
      : {};
  } catch {
    metadata = {};
  }
  const pendingArrivalGrace = pendingTriage
    && (
      triageRow?.triage_source === ARRIVAL_GRACE_SOURCE
      || metadata?.snoozedPending?.previousTriageSource === ARRIVAL_GRACE_SOURCE
    );
  if (pendingArrivalGrace && accountId) {
    await requeueArrivalGraceTriageForEmailFn(userId, accountId, uid, { dbClient, now });
    const restored = await attachArrivalGraceEmailToActiveSnapshotFn(userId, accountId, {
      ...snap,
      uid,
      email_id: uid,
    }, { dbClient, now });
    if (!restored) throw new Error("Unable to restore snoozed message");
  } else if (completedTriage && accountId
    && await unhideCompletedSnoozeItem(dbClient, userId, accountId, uid)) {
    // P3-61: mirrored the manual-wake path — the live triaged item already
    // exists, so we cleared dismissed_from_today_at to un-hide it in place
    // rather than re-deriving lane/summary from the snapshot JSON. Nothing
    // else to do; the existing triage fields stay untouched.
  } else {
    const restored = await attachResurfacedSnoozeToActiveSnapshotFn(userId, snap, {
      dbClient,
      now,
      resurfacedAt,
      pendingTriage,
    });
    if (!restored) throw new Error("Unable to restore snoozed message");
    if (pendingTriage && accountId) {
      await requeueEmailTriageForEmailFn(userId, accountId, uid, { dbClient });
    }
  }
}

async function unhideCompletedSnoozeItem(
  dbClient: SnapshotWriteDb,
  userId: string,
  accountId: string,
  emailId: string,
): Promise<boolean> {
  const itemResult = await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshot_items
          SET dismissed_from_today_at = NULL,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?
            AND provider_removed_at IS NULL
            AND snapshot_id IN (
              SELECT id FROM ea_briefing_snapshots
              WHERE user_id = ? AND status = 'active'
            )`,
    args: [userId, accountId, emailId, userId],
  });
  return Number(itemResult.rowsAffected || 0) > 0;
}

