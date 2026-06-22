import db from "../db/connection.js";
import { getEmailTriageModeForUser } from "./triage-mode.js";
import { ARRIVAL_GRACE_SOURCE } from "../snapshots/arrival-grace.js";
import {
  evaluateTriagePreflight,
  preflightDecisionMetadata,
} from "./triage-preflight.js";
import {
  fallbackDecision,
  normalizeModelDecision,
  triageDecisionFromPreflight,
} from "./triage-decision-normalize.js";
import {
  normalizeEmailInterests,
  emailTriageEventDetails,
  weakSecurityReadDecision,
} from "./triage-projections-model.js";
import { heuristicNoModelDecision } from "./triage-heuristic-scorer.js";
import { createTriageModelClient, loadTriageModelConfig } from "./triage-model-client.js";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import { cheapEscalationReason } from "./triage-escalation-policy.js";
import {
  claimNextEmailTriageJob,
  requeueClaimedJob,
  completeJob,
  deferJob,
  triageRetryBackoffIso,
  nowIso,
  MAX_TRIAGE_RETRY_ATTEMPTS,
} from "./triage-job-store.js";
import {
  loadEmailForJob,
  updateTriageRow,
  attachToActiveSnapshot,
  delayWeakSecurityGrace,
} from "./triage-finalize-store.js";
export { recoverStaleRunningTriageJobs, pruneCompletedTriageJobs } from "./triage-job-store.js";

const ARRIVAL_GRACE_READ_EXIT_DEFER_MS = 30 * 60 * 1000;

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

async function classifyWithModel(getModelClient, tier, email, reason) {
  const client = await getModelClient();
  if (!client?.classify) throw new Error("No triage model client configured");
  return normalizeModelDecision(await client.classify({ tier, email, reason }), tier);
}

// P1-7: per-batch, per-user memo so a backlog drain resolves mode, rules,
// interests, and the model client ONCE per user instead of re-reading ea_settings
// / ea_triage_rules and rebuilding the model client for every job in the tick.
// Pass the returned context to processNextEmailTriageJob({ batch }). Each getter
// caches the in-flight promise, so the value is loaded at most once per user.
export function createTriageBatchContext({ dbClient = db } = {}) {
  const memo = (cache, key, load) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key);
  };
  const modes = new Map();
  const rules = new Map();
  const interests = new Map();
  const modelClients = new Map();
  return {
    getMode: (userId) => memo(modes, userId, () => getEmailTriageModeForUser(userId, { dbClient })),
    getRules: (userId) => memo(rules, userId, () => loadRules(userId, dbClient)),
    getInterests: (userId) => memo(interests, userId, () => loadEmailInterests(userId, dbClient)),
    getModelClient: (userId) => memo(modelClients, userId, async () =>
      createTriageModelClient({ config: await loadTriageModelConfig(userId, dbClient) })),
  };
}

export async function routeEmailForTriage(email, {
  dbClient = db,
  modelClient,
  batch = null,
} = {}) {
  const [rules, interests] = batch
    ? await Promise.all([batch.getRules(email.user_id), batch.getInterests(email.user_id)])
    : await Promise.all([
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
      resolvedModelClient = batch
        ? await batch.getModelClient(email.user_id)
        : createTriageModelClient({
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

export async function processNextEmailTriageJob({
  dbClient = db,
  modelClient,
  now = new Date(),
  batch = null,
} = {}) {
  // P2-18: claim the next job first (one ordered scan + UPDATE), then check
  // paused mode using the claimed row's user_id. This eliminates the separate
  // peek SELECT that re-ran the identical ordered scan before every claim. A
  // paused user's claimed job is requeued with its pre-claim attempt count, so
  // pausing never consumes retry attempts.
  const job = await claimNextEmailTriageJob(dbClient, now);
  if (!job) return { processed: false };

  // P1-7: reuse the per-batch mode read when a batch context is supplied.
  const mode = batch
    ? await batch.getMode(job.user_id)
    : await getEmailTriageModeForUser(job.user_id, { dbClient });
  if (mode.effective_email_triage_mode === "paused") {
    await requeueClaimedJob(job, dbClient);
    return {
      processed: false,
      paused: true,
      ...mode,
    };
  }

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
      // No dashboard publish: this skip attaches nothing to the snapshot and leaves
      // the email in its existing lane, so the rendered view is unchanged. Publishing
      // would force a /current refetch + full re-render for no visible change; a
      // backlog of these would storm the dashboard. The next real triage finalize or
      // the periodic poll reconciles the processing count.
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
      // No dashboard publish: the user already dismissed this row (the UI reflected it
      // optimistically), and the skip attaches nothing to the snapshot — the rendered
      // view is unchanged, so a forced re-render here is redundant cost.
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
      // No dashboard publish: the user already snoozed this row (the UI reflected it
      // optimistically), and deferring its job attaches nothing to the snapshot — the
      // rendered view is unchanged.
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
      // No dashboard publish: provider unavailable during the weak-security grace,
      // so nothing is attached to the snapshot and the email stays in its lane — the
      // rendered view is unchanged.
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
      // Dev-only heuristic classifier (sender/subject/body bands -> lane). Replaces
      // the constant-needs_attention noModelDecision, which remains in
      // triage-decision-normalize.js as a labeled legacy fallback (no longer the default path).
      decision = heuristicNoModelDecision(email);
      modelCalls = [];
    } else {
      const routed = await routeEmailForTriage(email, { dbClient, modelClient, batch });
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
