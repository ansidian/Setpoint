import db from "../db/connection.js";
import {
  getOrCreateActiveSnapshot,
} from "../snapshots/snapshot-service.js";
import { getEmailTriageModeForUser } from "./triage-mode.js";
import { ARRIVAL_GRACE_SOURCE } from "../snapshots/arrival-grace.js";
import {
  evaluateTriagePreflight,
  preflightDecisionMetadata,
} from "./triage-preflight.js";
import {
  createTriageDecision,
  fallbackDecision,
  noModelDecision,
  normalizeModelDecision,
  triageDecisionFromPreflight,
} from "./triage-decision-normalize.js";
import { createTriageModelClient, loadTriageModelConfig } from "./triage-model-client.js";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import { cheapEscalationReason } from "./triage-escalation-policy.js";

const STALE_RUNNING_JOB_TYPES = ["email_triage", "gmail_history_sync"];
const DEFAULT_STALE_RUNNING_JOB_MS = 15 * 60 * 1000;
const WEAK_SECURITY_GRACE_MS = 10 * 60 * 1000;
const ARRIVAL_GRACE_READ_EXIT_DEFER_MS = 30 * 60 * 1000;

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nowIso(now) {
  return now.toISOString();
}

const TRIAGE_BACKOFF_BASE_MS = 30_000;
const TRIAGE_BACKOFF_CAP_MS = 10 * 60_000;
const MAX_TRIAGE_RETRY_ATTEMPTS = 5;

// Capped exponential backoff for re-queuing a triage job after a transient
// failure (provider 429/5xx or a mid-finalize error), so it isn't terminal.
function triageRetryBackoffIso(now, attempts) {
  const ms = Math.min(2 ** Number(attempts || 0) * TRIAGE_BACKOFF_BASE_MS, TRIAGE_BACKOFF_CAP_MS);
  return new Date(now.getTime() + ms).toISOString();
}

export async function recoverStaleRunningTriageJobs({
  dbClient = db,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_RUNNING_JOB_MS,
} = {}) {
  const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
  const result = await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'queued',
              locked_at = NULL,
              last_error = ?,
              updated_at = datetime('now')
          WHERE status = 'running'
            AND job_type IN (${STALE_RUNNING_JOB_TYPES.map(() => "?").join(", ")})
            AND locked_at IS NOT NULL
            AND locked_at <= ?`,
    args: ["Recovered stale running job", ...STALE_RUNNING_JOB_TYPES, staleBefore],
  });
  return { recovered: Number(result.rowsAffected || 0) };
}

function toText(value) {
  return String(value || "").toLowerCase();
}

function emailSearchText(email) {
  return [
    email.from_name,
    email.from_address,
    email.subject,
    email.body_snippet,
    email.body_text,
  ].map(toText).join("\n");
}

function normalizeEmailInterests(raw) {
  const parsed = typeof raw === "string" ? safeJson(raw, []) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((interest) => String(interest || "").trim())
    .filter(Boolean);
}

async function loadRules(userId, dbClient) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_triage_rules
          WHERE user_id = ? AND enabled = 1
          ORDER BY priority ASC, id ASC`,
    args: [userId],
  });
  return result.rows;
}

async function loadEmailInterests(userId, dbClient) {
  try {
    const result = await dbClient.execute({
      sql: "SELECT email_interests_json FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    return normalizeEmailInterests(result.rows?.[0]?.email_interests_json);
  } catch {
    return [];
  }
}

function mergeModelUsage(...parts) {
  return Object.assign({}, ...parts.filter(Boolean));
}

function triageSoundTriggerType(reason, lane) {
  if (reason === "weak_security_grace_delayed") return "weak_security_grace";
  if (reason === "email_triage_failed") return "triage_failed";
  if (reason === "email_triage_finalized") {
    if (lane === "needs_attention") return "needs_attention_finalized";
    if (lane === "fyi") return "fyi_finalized";
  }
  return "triage_event";
}

function emailTriageEventDetails(email, { reason, lane, triageSource }) {
  return {
    triggerType: triageSoundTriggerType(reason, lane),
    eventKey: `email_triage:${email.account_id}:${email.email_id}:${reason}`,
    emailId: email.email_id,
    lane,
    triageSource,
    reason,
  };
}

function maybeBillCandidate(email, decision) {
  if (decision.bill_candidate) return decision.bill_candidate;
  const text = emailSearchText(email);
  const looksFinancial = /\$\s*\d|payment|invoice|statement|balance|autopay|due/.test(text);
  if (!looksFinancial) return null;
  if (decision.category !== "finance" && !/\$\s*\d/.test(text)) return null;
  return {
    source: "triage",
    payee_hint: email.from_name || email.from_address || "",
    subject: email.subject || "",
    amount: null,
    due_date: decision.deadline_at || null,
    requires_confirmation: true,
  };
}

async function classifyWithModel(getModelClient, tier, email, reason) {
  const client = await getModelClient();
  if (!client?.classify) throw new Error("No triage model client configured");
  return normalizeModelDecision(await client.classify({ tier, email, reason }), tier);
}

export async function routeEmailForTriage(email, {
  dbClient = db,
  modelClient,
} = {}) {
  const [rules, interests] = await Promise.all([
    loadRules(email.user_id, dbClient),
    loadEmailInterests(email.user_id, dbClient),
  ]);
  const preflight = evaluateTriagePreflight(email, {
    rules,
    emailInterests: interests,
    graceAlreadyUsed: email.triage_source === "weak_security_grace",
  });
  const modelCalls = [];
  let resolvedModelClient = modelClient;
  const getModelClient = async () => {
    if (!resolvedModelClient) {
      resolvedModelClient = createTriageModelClient({
        config: await loadTriageModelConfig(email.user_id, dbClient),
      });
    }
    return resolvedModelClient;
  };

  const preflightDecision = triageDecisionFromPreflight(preflight);
  if (preflightDecision) {
    return {
      decision: {
        ...preflightDecision,
        last_decision_reason: `preflight:${preflight.reasonCode}`,
      },
      modelCalls,
    };
  }

  if (preflight.action === "grace") {
    return {
      grace: true,
      preflight,
      decision: null,
      modelCalls,
    };
  }

  const metadata = preflightDecisionMetadata(preflight);
  const routeTier = preflight.modelTier === "strong" ? "strong" : "cheap";
  if (routeTier === "strong") {
    const strong = await classifyWithModel(getModelClient, "strong", email, preflight.reasonCode);
    modelCalls.push("strong");
    return {
      decision: {
        ...strong,
        rule_id: preflight.ruleId || null,
        decision_metadata: metadata,
        last_decision_reason: `routed_strong:${preflight.reasonCode}`,
      },
      modelCalls,
    };
  }

  const cheap = await classifyWithModel(getModelClient, "cheap", email, preflight.reasonCode);
  modelCalls.push("cheap");
  const escalationReason = cheapEscalationReason(cheap);
  if (!escalationReason) {
    return {
      decision: {
        ...cheap,
        decision_metadata: metadata,
        last_decision_reason: "cheap_accepted",
      },
      modelCalls,
    };
  }

  const strong = await classifyWithModel(getModelClient, "strong", email, "Cheap model confidence or risk required escalation.");
  modelCalls.push("strong");
  return {
    decision: {
      ...strong,
      triage_source: "strong_model",
      model_usage: mergeModelUsage(cheap.model_usage, strong.model_usage),
      cheap_model_result: cheap.cheap_model_result,
      strong_model_result: strong.strong_model_result,
      estimated_cost_usd: Number(cheap.estimated_cost_usd || 0) + Number(strong.estimated_cost_usd || 0),
      latency_ms: Number(cheap.latency_ms || 0) + Number(strong.latency_ms || 0),
      decision_metadata: metadata,
      last_decision_reason: `escalated:${escalationReason}`,
    },
    modelCalls,
  };
}

async function claimNextEmailTriageJob(dbClient, now) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_triage_jobs
          WHERE job_type = 'email_triage'
            AND status = 'queued'
            AND (scheduled_for IS NULL OR scheduled_for <= ?)
          ORDER BY priority ASC, created_at ASC
          LIMIT 1`,
    args: [nowIso(now)],
  });
  const job = result.rows[0] || null;
  if (!job) return null;
  const claim = await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'running',
              attempts = attempts + 1,
              locked_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND status = 'queued'`,
    args: [nowIso(now), job.id],
  });
  if (Number(claim.rowsAffected || 0) === 0) return null;
  return job;
}

async function peekNextEmailTriageJob(dbClient, now) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_triage_jobs
          WHERE job_type = 'email_triage'
            AND status = 'queued'
            AND (scheduled_for IS NULL OR scheduled_for <= ?)
          ORDER BY priority ASC, created_at ASC
          LIMIT 1`,
    args: [nowIso(now)],
  });
  return result.rows[0] || null;
}

async function loadEmailForJob(job, dbClient) {
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
          WHERE t.user_id = ?
            AND t.account_id = ?
            AND t.email_id = ?
          LIMIT 1`,
    args: [job.user_id, job.account_id, job.email_id],
  });
  return result.rows[0] || null;
}

async function updateTriageRow(email, decision, {
  dbClient,
  now,
  status = "complete",
  inferBillCandidate = true,
} = {}) {
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
      decision.decision_metadata ? JSON.stringify(decision.decision_metadata) : null,
      decision.last_decision_reason || null,
      nowIso(now),
      email.triage_id,
    ],
  });
}

async function attachToActiveSnapshot(email, decision, { dbClient, now }) {
  const snapshot = await getOrCreateActiveSnapshot(email.user_id, { dbClient, now });
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
      email.triage_id,
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

async function delayWeakSecurityGrace(job, email, preflight, { dbClient, now }) {
  const classifyAfter = new Date(now.getTime() + WEAK_SECURITY_GRACE_MS).toISOString();
  const decisionMetadata = preflightDecisionMetadata(preflight);
  await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET triage_status = 'pending',
              triage_source = 'weak_security_grace',
              category = 'security',
              urgency = 'normal',
              summary = 'Security triage pending.',
              action = 'Classifying soon',
              decision_metadata_json = ?,
              last_decision_reason = 'weak_security_grace_pending',
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [JSON.stringify(decisionMetadata), email.triage_id],
  });

  await attachToActiveSnapshot(email, {
    lane: "needs_attention",
    category: "security",
    urgency: "normal",
    escalation_badge: null,
    summary: "Security triage pending.",
    action: "Classifying soon",
    deadline_at: null,
    snapshot_source: "pending_security_grace",
    snapshot_source_at: classifyAfter,
  }, { dbClient, now });

  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'queued',
              locked_at = NULL,
              scheduled_for = ?,
              completed_at = NULL,
              last_error = '',
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [classifyAfter, job.id],
  });

  publishCurrentDashboardEvent(email.user_id, {
    source: "email_triage",
    reason: "weak_security_grace_delayed",
    state: "current",
    occurredAt: nowIso(now),
    details: emailTriageEventDetails(email, {
      reason: "weak_security_grace_delayed",
      lane: "needs_attention",
      triageSource: "weak_security_grace",
    }),
  });

  return classifyAfter;
}

function weakSecurityReadDecision() {
  return createTriageDecision({
    lane: "fyi",
    category: "security",
    urgency: "low",
    summary: "Security notification was read during the grace window.",
    action: "No action needed.",
    confidence: 0.86,
    triage_source: "weak_security_grace_read",
    last_decision_reason: "weak_security_grace_read",
    decision_metadata: {
      weakSecurityGrace: {
        outcome: "read_in_inbox",
        modelSaved: true,
      },
    },
  });
}

async function completeJob(job, dbClient, now, lastError = "") {
  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'complete',
              completed_at = ?,
              locked_at = NULL,
              scheduled_for = NULL,
              last_error = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [nowIso(now), lastError, job.id],
  });
}

async function deferJob(job, dbClient, scheduledFor, lastError = "") {
  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'queued',
              locked_at = NULL,
              scheduled_for = ?,
              completed_at = NULL,
              last_error = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [scheduledFor, lastError, job.id],
  });
}

export async function processNextEmailTriageJob({
  dbClient = db,
  modelClient,
  now = new Date(),
} = {}) {
  const nextJob = await peekNextEmailTriageJob(dbClient, now);
  if (!nextJob) return { processed: false };

  const mode = await getEmailTriageModeForUser(nextJob.user_id, { dbClient });
  if (mode.effective_email_triage_mode === "paused") {
    return {
      processed: false,
      paused: true,
      ...mode,
    };
  }

  const job = await claimNextEmailTriageJob(dbClient, now);
  if (!job) return { processed: false };

  const email = await loadEmailForJob(job, dbClient);
  if (!email) {
    await completeJob(job, dbClient, now, `Missing triage email ${job.email_id}`);
    return { processed: true, job_id: Number(job.id), skipped: true };
  }

  if (email.triage_status === "complete" && email.last_triaged_at) {
    await completeJob(job, dbClient, now);
    return {
      processed: true,
      job_id: Number(job.id),
      email_id: email.email_id,
      skipped: true,
    };
  }

  let decision;
  let modelCalls = [];
  let status = "complete";
  try {
    if (email.triage_source !== "weak_security_grace" && email.provider_state !== "available") {
      await completeJob(job, dbClient, now, `Skipped pending triage; provider state ${email.provider_state}`);
      publishCurrentDashboardEvent(email.user_id, {
        source: "email_triage",
        reason: "provider_unavailable_skipped",
        state: "current",
        occurredAt: nowIso(now),
      });
      return {
        processed: true,
        job_id: Number(job.id),
        email_id: email.email_id,
        skipped: true,
        source: "provider_unavailable_skip",
        model_calls: [],
      };
    }

    if (email.triage_source === ARRIVAL_GRACE_SOURCE && email.read) {
      const nextCheckAt = new Date(now.getTime() + ARRIVAL_GRACE_READ_EXIT_DEFER_MS).toISOString();
      await deferJob(job, dbClient, nextCheckAt, "Waiting for Inbox exit before settling read arrival-grace email");
      return {
        processed: true,
        job_id: Number(job.id),
        email_id: email.email_id,
        skipped: true,
        source: "arrival_grace_read_deferred",
        scheduled_for: nextCheckAt,
        model_calls: [],
      };
    }

    if (email.dismissed_at) {
      await completeJob(job, dbClient, now, "Skipped pending triage; user dismissed row");
      publishCurrentDashboardEvent(email.user_id, {
        source: "email_triage",
        reason: "user_dismissed_pending_skipped",
        state: "current",
        occurredAt: nowIso(now),
      });
      return {
        processed: true,
        job_id: Number(job.id),
        email_id: email.email_id,
        skipped: true,
        source: "user_dismissed_pending_skip",
        model_calls: [],
      };
    }

    const snoozedUntilTs = Number(email.snoozed_until_ts);
    if (Number.isFinite(snoozedUntilTs) && snoozedUntilTs > now.getTime()) {
      const scheduledFor = new Date(snoozedUntilTs).toISOString();
      await deferJob(job, dbClient, scheduledFor, "Deferred pending triage while snoozed");
      publishCurrentDashboardEvent(email.user_id, {
        source: "email_triage",
        reason: "snoozed_pending_deferred",
        state: "current",
        occurredAt: nowIso(now),
      });
      return {
        processed: true,
        job_id: Number(job.id),
        email_id: email.email_id,
        delayed: true,
        scheduled_for: scheduledFor,
        source: "snoozed_pending",
        model_calls: [],
      };
    }

    if (email.triage_source === "weak_security_grace" && email.provider_state !== "available") {
      await completeJob(job, dbClient, now, `Skipped weak-security grace; provider state ${email.provider_state}`);
      publishCurrentDashboardEvent(email.user_id, {
        source: "email_triage",
        reason: "weak_security_grace_skipped",
        state: "current",
        occurredAt: nowIso(now),
      });
      return {
        processed: true,
        job_id: Number(job.id),
        email_id: email.email_id,
        skipped: true,
        source: "weak_security_grace_skip",
        model_calls: [],
      };
    }
    if (email.triage_source === "weak_security_grace" && email.read) {
      decision = weakSecurityReadDecision();
      modelCalls = [];
    } else if (mode.effective_email_triage_mode === "no_model") {
      decision = noModelDecision(email);
      modelCalls = [];
    } else {
      const routed = await routeEmailForTriage(email, { dbClient, modelClient });
      if (routed.grace) {
        const classifyAfter = await delayWeakSecurityGrace(job, email, routed.preflight, {
          dbClient,
          now,
        });
        return {
          processed: true,
          job_id: Number(job.id),
          email_id: email.email_id,
          delayed: true,
          scheduled_for: classifyAfter,
          source: "weak_security_grace",
          model_calls: [],
        };
      }
      decision = routed.decision;
      modelCalls = routed.modelCalls;
    }
  } catch (err) {
    if (err?.retryable && Number(job.attempts || 0) < MAX_TRIAGE_RETRY_ATTEMPTS) {
      // Transient provider error (429/5xx): re-queue with backoff instead of
      // permanently misclassifying the email as a failure_fallback.
      const scheduledFor = triageRetryBackoffIso(now, job.attempts);
      await deferJob(job, dbClient, scheduledFor, `Retryable triage error: ${err.message}`);
      return { processed: true, job_id: Number(job.id), deferred: true, scheduled_for: scheduledFor };
    }
    decision = fallbackDecision(email, err);
    status = "failed";
  }

  try {
    // Attach BEFORE marking the triage row complete: that ordering makes a
    // 'complete' status imply the snapshot item already exists, so the recovery
    // early-exit can safely complete the job without re-attaching. The snapshot
    // upsert is idempotent, so a retry after a partial finalize is harmless.
    await attachToActiveSnapshot(email, decision, { dbClient, now });
    await updateTriageRow(email, decision, {
      dbClient,
      now,
      status,
      inferBillCandidate: mode.effective_email_triage_mode !== "no_model",
    });
    await completeJob(job, dbClient, now, status === "failed" ? decision.error : "");
  } catch (finalizeErr) {
    // A finalize step failed; re-queue so the job isn't left stuck in 'running'.
    const scheduledFor = triageRetryBackoffIso(now, job.attempts);
    await deferJob(job, dbClient, scheduledFor, `Finalize failed: ${finalizeErr.message}`);
    return { processed: true, job_id: Number(job.id), deferred: true, scheduled_for: scheduledFor };
  }
  publishCurrentDashboardEvent(email.user_id, {
    source: "email_triage",
    reason: status === "failed" ? "email_triage_failed" : "email_triage_finalized",
    state: "current",
    occurredAt: nowIso(now),
    details: emailTriageEventDetails(email, {
      reason: status === "failed" ? "email_triage_failed" : "email_triage_finalized",
      lane: decision.lane,
      triageSource: decision.triage_source,
    }),
  });

  return {
    processed: true,
    job_id: Number(job.id),
    email_id: email.email_id,
    lane: decision.lane,
    source: decision.triage_source,
    model_calls: modelCalls,
  };
}
