import { getOrCreateActiveSnapshot } from "../snapshots/snapshot-service.ts";
import { maybeBillCandidate } from "./triage-projections-model.ts";
import { nowIso } from "./triage-job-store.ts";
import type { SnapshotWriteDb } from "../snapshots/snapshot-types.ts";
import type {
  TriageDb,
  TriageDecision,
  TriageEmail,
  TriageJob,
  TriageLane,
  TriageUrgency,
} from "./triage-types.ts";
import type { FinancialEmailPlan } from "../../shared/types/bills.ts";

interface SnapshotTriageProjection {
  lane: TriageLane;
  category: string;
  urgency: TriageUrgency;
  escalation_badge: string | null;
  summary: string;
  action: string;
  deadline_at: string | null;
  snapshot_source?: string | null;
  snapshot_source_at?: string | null;
}

// ea_email_triage + ea_briefing_snapshot_items persistence lifted from
// triage-worker.ts: load the email for a job, write the triage decision row,
// attach/upsert the snapshot item. Keeps the
// attach-before-complete ordering invariant in the worker (it sequences attach ->
// update -> complete); this store owns the individual writes.

export async function loadEmailForJob(job: TriageJob, dbClient: TriageDb): Promise<TriageEmail | null> {
  const result = await dbClient.execute({
    sql: `SELECT t.id AS triage_id,
                 t.triage_status,
                 t.triage_source,
                 t.last_triaged_at,
                 t.provider_state,
                 t.dismissed_at,
                 t.user_id,
                 t.account_id,
                 t.email_id,
                 t.thread_id,
                 i.account_label,
                 i.account_email,
                 i.account_color,
                 i.account_icon,
                 i.from_name,
                 i.from_address,
                 i.subject,
                 i.body_snippet,
                 i.body_text,
                 i.email_date,
                 i.email_date_utc,
                 i.sender_authentication_json,
                 i.read,
                 sz.until_ts AS snoozed_until_ts
          FROM ea_email_triage t
          LEFT JOIN ea_email_index i
            ON i.uid = t.email_id
           AND i.user_id = t.user_id
           AND i.account_id = t.account_id
          LEFT JOIN ea_snoozed_emails sz
            ON sz.user_id = t.user_id
           AND sz.email_id = t.email_id
           AND sz.status = 'snoozed'
            -- ea_snoozed_emails has no account_id
            -- (PK is user_id+email_id), so a cross-account uid collision (icloud uids
            -- don't embed account.id) could defer the wrong account's email. Scope the
            -- snooze to this account by requiring the uid to resolve to t.account_id in
            -- the account-scoped index (ea_email_index.uid is a global PK -> one account).
            -- Full fix (add account_id column + backfill) is flagged out-of-scope.
           AND EXISTS (
             SELECT 1 FROM ea_email_index si
             WHERE si.uid = sz.email_id
               AND si.user_id = sz.user_id
               AND si.account_id = t.account_id
           )
          WHERE t.user_id = ?
            AND t.account_id = ?
            AND t.email_id = ?
          LIMIT 1`,
    args: [job.user_id, job.account_id, job.email_id],
  });
  return result.rows[0] as TriageEmail | undefined || null;
}

export async function updateTriageRow(email: TriageEmail, decision: TriageDecision, {
  dbClient,
  now,
  status = "complete",
  inferBillCandidate = true,
  financialEmailPlan = null,
}: {
  dbClient: TriageDb;
  now: Date;
  status?: string;
  inferBillCandidate?: boolean;
  financialEmailPlan?: FinancialEmailPlan | null;
}): Promise<void> {
  const billCandidate = inferBillCandidate ? maybeBillCandidate(email, decision) : null;
  await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET lane = ?,
              category = ?,
              urgency = ?,
              escalation_badge = ?,
              summary = ?,
              action = ?,
              deadline_at = ?,
              confidence = ?,
              triage_status = ?,
              triage_source = ?,
              rule_id = ?,
              cheap_model_result_json = ?,
              strong_model_result_json = ?,
              model_usage_json = ?,
              estimated_cost_usd = ?,
              latency_ms = ?,
              bill_candidate_json = ?,
              financial_email_plan_json = ?,
              decision_metadata_json = ?,
              last_decision_reason = ?,
              last_triaged_at = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [
      decision.lane,
      decision.category,
      decision.urgency,
      decision.escalation_badge,
      decision.summary,
      decision.action,
      decision.deadline_at,
      decision.confidence,
      status,
      decision.triage_source,
      decision.rule_id,
      decision.cheap_model_result ? JSON.stringify(decision.cheap_model_result) : null,
      decision.strong_model_result ? JSON.stringify(decision.strong_model_result) : null,
      JSON.stringify(decision.model_usage || {}),
      decision.estimated_cost_usd,
      decision.latency_ms,
      billCandidate ? JSON.stringify(billCandidate) : null,
      financialEmailPlan ? JSON.stringify(financialEmailPlan) : null,
      decision.decision_metadata ? JSON.stringify(decision.decision_metadata) : null,
      decision.last_decision_reason || null,
      nowIso(now),
      email.triage_id ?? null,
    ],
  });
}

export async function attachToActiveSnapshot(email: TriageEmail, decision: SnapshotTriageProjection, { dbClient, now }: { dbClient: TriageDb; now: Date }): Promise<void> {
  const snapshot = await getOrCreateActiveSnapshot(email.user_id, { dbClient: dbClient as unknown as SnapshotWriteDb, now });
  await dbClient.execute({
    sql: `INSERT INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id,
             lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
             urgency_at_snapshot, deadline_at_snapshot, category_at_snapshot,
             escalation_badge_at_snapshot, subject_at_snapshot,
             from_name_at_snapshot, from_address_at_snapshot, email_date_at_snapshot,
             account_label_at_snapshot, account_email_at_snapshot,
             account_color_at_snapshot, account_icon_at_snapshot, sort_order,
             source, source_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(snapshot_id, triage_id) DO UPDATE SET
            lane_at_snapshot = excluded.lane_at_snapshot,
            summary_at_snapshot = excluded.summary_at_snapshot,
            action_at_snapshot = excluded.action_at_snapshot,
            urgency_at_snapshot = excluded.urgency_at_snapshot,
            deadline_at_snapshot = excluded.deadline_at_snapshot,
            category_at_snapshot = excluded.category_at_snapshot,
            escalation_badge_at_snapshot = excluded.escalation_badge_at_snapshot,
            subject_at_snapshot = excluded.subject_at_snapshot,
            from_name_at_snapshot = excluded.from_name_at_snapshot,
            from_address_at_snapshot = excluded.from_address_at_snapshot,
            email_date_at_snapshot = excluded.email_date_at_snapshot,
            source = excluded.source,
            source_at = excluded.source_at,
            updated_at = datetime('now')`,
    args: [
      snapshot.id,
      email.triage_id ?? null,
      email.user_id,
      email.account_id,
      email.email_id,
      decision.lane,
      decision.summary,
      decision.action,
      decision.urgency,
      decision.deadline_at,
      decision.category,
      decision.escalation_badge,
      email.subject || "",
      email.from_name || "",
      email.from_address || "",
      email.email_date || null,
      email.account_label || "",
      email.account_email || "",
      email.account_color || "#818cf8",
      email.account_icon || "Mail",
      0,
      decision.snapshot_source || null,
      decision.snapshot_source_at || null,
    ],
  });
}
