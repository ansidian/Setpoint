import db from "../db/connection.ts";
import { getEmailTriageClassifyReadArrivalsForUser } from "../platform/config-service.ts";
import { getEmailTriageModeForUser } from "./triage-mode.ts";
import { ARRIVAL_GRACE_SOURCE } from "../snapshots/arrival-grace.ts";
import {
  evaluateTriagePreflight,
  preflightDecisionMetadata,
} from "./triage-preflight.ts";
import {
  fallbackDecision,
  normalizeModelDecision,
  triageDecisionFromPreflight,
} from "./triage-decision-normalize.ts";
import {
  normalizeEmailInterests,
  emailTriageEventDetails,
} from "./triage-projections-model.ts";
import { heuristicNoModelDecision } from "./triage-heuristic-scorer.ts";
import { createTriageModelClient, loadTriageModelConfig } from "./triage-model-client.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.ts";
import { cheapEscalationReason } from "./triage-escalation-policy.ts";
import { planFinancialEmail } from "../bills/bills-service.ts";
import { financialEmailSourceIdentity } from "../bills/financial-email-planner.ts";
import type { BillCandidate, FinancialEmailPlan } from "../../shared/types/bills.ts";
import {
  claimNextEmailTriageJob,
  requeueClaimedJob,
  completeJob,
  deferJob,
  triageRetryBackoffIso,
  nowIso,
  MAX_TRIAGE_RETRY_ATTEMPTS,
} from "./triage-job-store.ts";
import {
  loadEmailForJob,
  updateTriageRow,
  attachToActiveSnapshot,
} from "./triage-finalize-store.ts";
import type {
  TriageBatchContext,
  TriageDb,
  TriageDecision,
  TriageEmail,
  TriageModelClient,
  TriageModelTier,
  TriageRule,
} from "./triage-types.ts";
import { triageError } from "./triage-types.ts";
import { stageFinancialEmailPreflight } from "../transaction-imports/financial-email-preflight.ts";
export {
  getNextEmailTriageWakeAt,
  recoverStaleRunningTriageJobs,
  pruneCompletedTriageJobs,
  triageRetryBackoffIso,
} from "./triage-job-store.ts";

const ARRIVAL_GRACE_READ_EXIT_DEFER_MS = 30 * 60 * 1000;

interface RouteEmailResult {
  decision: TriageDecision;
  modelCalls: TriageModelTier[];
}

async function loadRules(userId: string, dbClient: TriageDb): Promise<TriageRule[]> {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_triage_rules
          WHERE user_id = ? AND enabled = 1
          ORDER BY priority ASC, id ASC`,
    args: [userId],
  });
  return result.rows as TriageRule[];
}

async function loadEmailInterests(userId: string, dbClient: TriageDb): Promise<string[]> {
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

function mergeModelUsage(...parts: Array<Record<string, unknown> | null | undefined>): Record<string, unknown> {
  return Object.assign({}, ...parts.filter(Boolean));
}

async function classifyWithModel(getModelClient: () => Promise<TriageModelClient>, tier: TriageModelTier, email: TriageEmail, reason: string): Promise<TriageDecision> {
  const client = await getModelClient();
  if (!client?.classify) throw new Error("No triage model client configured");
  return normalizeModelDecision(await client.classify({ tier, email, reason }), tier);
}

// P1-7: per-batch, per-user memo so a backlog drain resolves mode, the
// read-arrivals preference, rules, interests, and the model client ONCE per user
// instead of re-reading ea_settings / ea_triage_rules and rebuilding the model
// client for every job in the tick.
// Pass the returned context to processNextEmailTriageJob({ batch }). Each getter
// caches the in-flight promise, so the value is loaded at most once per user.
//
// Lifetime contract (REL-09): this context is created fresh per worker tick
// (scheduler.ts runEmailTriageWorker) and per snapshot sync
// (snapshot-service.ts runActiveSnapshotSync) and must stay that way.
// Do NOT hoist it to module scope or any longer-lived owner: the Maps have
// no eviction, and modelClients retains constructed LLM clients. If this
// ever becomes long-lived or multi-user, add a size bound / TTL eviction.
export function createTriageBatchContext({ dbClient = db as unknown as TriageDb }: { dbClient?: TriageDb } = {}): TriageBatchContext {
  const memo = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key)!;
  };
  const modes = new Map<string, ReturnType<TriageBatchContext["getMode"]>>();
  const classifyReadArrivals = new Map<string, ReturnType<TriageBatchContext["getClassifyReadArrivals"]>>();
  const rules = new Map<string, ReturnType<TriageBatchContext["getRules"]>>();
  const interests = new Map<string, ReturnType<TriageBatchContext["getInterests"]>>();
  const modelClients = new Map<string, ReturnType<TriageBatchContext["getModelClient"]>>();
  return {
    getMode: (userId) => memo(modes, userId, () => getEmailTriageModeForUser(userId, { dbClient })),
    getClassifyReadArrivals: (userId) => memo(
      classifyReadArrivals,
      userId,
      () => getEmailTriageClassifyReadArrivalsForUser(userId, { dbClient }),
    ),
    getRules: (userId) => memo(rules, userId, () => loadRules(userId, dbClient)),
    getInterests: (userId) => memo(interests, userId, () => loadEmailInterests(userId, dbClient)),
    getModelClient: (userId) => memo(modelClients, userId, async () =>
      createTriageModelClient({ config: await loadTriageModelConfig(userId, dbClient) })),
  };
}

export async function routeEmailForTriage(email: TriageEmail, {
  dbClient = db as unknown as TriageDb,
  modelClient,
  batch = null,
}: { dbClient?: TriageDb; modelClient?: TriageModelClient; batch?: TriageBatchContext | null } = {}): Promise<RouteEmailResult> {
  const [rules, interests] = batch
    ? await Promise.all([batch.getRules(email.user_id), batch.getInterests(email.user_id)])
    : await Promise.all([
      loadRules(email.user_id, dbClient),
      loadEmailInterests(email.user_id, dbClient),
    ]);
  const preflight = evaluateTriagePreflight(email, { rules, emailInterests: interests });
  const modelCalls: TriageModelTier[] = [];
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
  dbClient = db as unknown as TriageDb,
  modelClient,
  now = new Date(),
  batch = null,
  financialEmailPlanner = planFinancialEmail,
  financialEmailPreflight = stageFinancialEmailPreflight,
}: {
  dbClient?: TriageDb;
  modelClient?: TriageModelClient;
  now?: Date;
  batch?: TriageBatchContext | null;
  financialEmailPlanner?: typeof planFinancialEmail;
  financialEmailPreflight?: typeof stageFinancialEmailPreflight;
} = {}): Promise<Record<string, unknown>> {
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
  const classifyReadArrivals = batch
    ? await batch.getClassifyReadArrivals(job.user_id)
    : await getEmailTriageClassifyReadArrivalsForUser(job.user_id, { dbClient });

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

  let decision: TriageDecision | null = null;
  let modelCalls: TriageModelTier[] = [];
  let status = "complete";
  try {
    if (email.provider_state !== "available") {
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

    if (email.triage_source === ARRIVAL_GRACE_SOURCE && email.read && !classifyReadArrivals) {
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

    if (mode.effective_email_triage_mode === "no_model") {
      // Dev-only heuristic classifier (sender/subject/body bands -> lane).
      decision = heuristicNoModelDecision(email);
      modelCalls = [];
    } else {
      const routed = await routeEmailForTriage(email, { dbClient, modelClient, batch });
      decision = routed.decision;
      modelCalls = routed.modelCalls;
    }
  } catch (caught) {
    const err = triageError(caught);
    // claimNextEmailTriageJob already incremented attempts in the DB, but `job`
    // is the SELECT snapshot taken before that UPDATE — job.attempts is the
    // pre-claim value, so the current attempt count is job.attempts + 1 (same
    // stale-snapshot correction as gmail-sync.ts).
    const currentAttempts = Number(job.attempts || 0) + 1;
    if (err?.retryable && currentAttempts < MAX_TRIAGE_RETRY_ATTEMPTS) {
      // Transient provider error (429/5xx): re-queue with backoff instead of
      // permanently misclassifying the email as a failure_fallback.
      const scheduledFor = triageRetryBackoffIso(now, currentAttempts);
      await deferJob(job, dbClient, scheduledFor, `Retryable triage error: ${err.message}`);
      return { processed: true, job_id: Number(job.id), deferred: true, scheduled_for: scheduledFor };
    }
    decision = fallbackDecision(email, err);
    status = "failed";
  }

  if (!decision) throw new Error("Triage route returned no decision");

  let financialEmailPlan: FinancialEmailPlan | null = null;
  if (decision.bill_candidate) {
    financialEmailPlan = await financialEmailPlanner(email.user_id, {
      email: {
        from: [email.from_name, email.from_address].filter(Boolean).join(" "),
        from_name: email.from_name,
        from_address: email.from_address,
        subject: email.subject,
        body: email.body_text,
        body_snippet: email.body_snippet,
      },
      candidate: decision.bill_candidate as BillCandidate,
      source: "triage",
      providerMessageId: email.email_id,
      sourceIdentity: financialEmailSourceIdentity(email),
    });
    decision = { ...decision, bill_candidate: financialEmailPlan.candidate };
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
      financialEmailPlan,
    });
    if (financialEmailPlan) {
      await financialEmailPreflight(email.user_id, {
        accountId: email.account_id,
        emailId: email.email_id,
        emailSubject: String(email.subject || ""),
        emailFrom: String(email.from_address || email.from_name || ""),
        emailBody: String(email.body_text || email.body_snippet || ""),
      }, financialEmailPlan).catch(() => undefined);
    }
    await completeJob(job, dbClient, now, status === "failed" ? decision.error || "" : "");
  } catch (caught) {
    const finalizeErr = triageError(caught);
    // A finalize step failed; re-queue so the job isn't left stuck in 'running'.
    // job.attempts is the stale pre-claim snapshot; +1 is the actual attempt count.
    const scheduledFor = triageRetryBackoffIso(now, Number(job.attempts || 0) + 1);
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
