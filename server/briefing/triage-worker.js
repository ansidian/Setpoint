import db from "../db/connection.js";
import { getOrCreateActiveSnapshot } from "./snapshot-service.js";
import { getEmailTriageModeForUser } from "./triage-mode.js";
import { resolveEmailAiModelConfig, inferEmailAiProviderFromModel } from "./email-ai-models.js";
import {
  evaluateTriagePreflight,
  preflightDecisionMetadata,
  triageDecisionFromPreflight,
} from "./triage-preflight.js";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
  isAllowedBillExtractModel,
} from "./bill-extractors/catalog.js";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";

const CHEAP_CONFIDENCE_FLOOR = 0.72;
const RISK_CATEGORIES = new Set(["finance", "security", "legal", "school"]);
const DEFAULT_CHEAP_MODEL = DEFAULT_BILL_EXTRACT_MODEL;
const DEFAULT_STRONG_MODEL = "claude-sonnet-4-6";
const STALE_RUNNING_JOB_TYPES = ["email_triage", "gmail_history_sync"];
const DEFAULT_STALE_RUNNING_JOB_MS = 15 * 60 * 1000;
const WEAK_SECURITY_GRACE_MS = 10 * 60 * 1000;
const TRIAGE_PROMPT_CACHE_VERSION = "v1";

const TRIAGE_TOOL = {
  name: "submit_email_triage",
  description: "Submit one durable email triage decision.",
  input_schema: {
    type: "object",
    properties: {
      lane: { type: "string", enum: ["needs_attention", "fyi", "noise"] },
      category: {
        type: "string",
        enum: [
          "finance",
          "security",
          "legal",
          "school",
          "personal",
          "work",
          "delivery",
          "infra",
          "updates",
          "marketing",
          "product",
          "social",
          "uncategorized",
          "utilities",
        ],
      },
      urgency: { type: "string", enum: ["high", "medium", "normal", "low"] },
      escalation_badge: { type: ["string", "null"] },
      summary: { type: "string" },
      action: { type: "string" },
      deadline_at: { type: ["string", "null"] },
      confidence: { type: "number" },
      bill_candidate: {
        type: ["object", "null"],
        properties: {
          payee_hint: { type: ["string", "null"] },
          amount: { type: ["number", "null"] },
          due_date: { type: ["string", "null"] },
          requires_confirmation: { type: "boolean" },
        },
      },
    },
    required: [
      "lane",
      "category",
      "urgency",
      "escalation_badge",
      "summary",
      "action",
      "deadline_at",
      "confidence",
      "bill_candidate",
    ],
  },
};

const TRIAGE_SYSTEM_PROMPT = `Classify one email for a personal executive-assistant dashboard.

Return a durable triage decision. Optimize for dangerous-miss prevention:
- needs_attention: real consequence, required reply, required decision, payment issue, hard deadline, school/legal/security/finance risk, service interruption risk, or risky ambiguity.
- fyi: useful real account activity, confirmations, receipts, statements, shipping, routine payment/autopay notices, routine security confirmations, or context that does not require action.
- noise: promotions, newsletters, surveys, coupons, generic marketing, and low-value bulk mail.

Rules:
- Use exactly one lane: needs_attention, fyi, noise.
- Categories are metadata, not lanes.
- Escalation is a badge/status, not a lane.
- Optional soft actions do not create needs_attention. Soft actions include review, track, check, read, browse, consider, look at, review if interested, and monitor.
- Routine shipped/delivered notices, successful payment confirmations, scheduled autopay notices, and ordinary receipts are fyi unless there is a real consequence or unresolved risk.
- Marketing, recommendations, coupons, surveys, and generic newsletters are noise unless the sender/content matches a configured user interest or another real risk is present.
- Payment due ambiguity, low balance, failed payment, card expiration, service interruption, legal/school deadlines, and suspicious security events must stay needs_attention or escalate.
- If a specific deadline or due date exists, set deadline_at as an ISO timestamp or null if uncertain.
- Finance/payment bill candidates must require confirmation; never imply an Actual Budget write.
- Be compact. Summary and action should each be short enough for a dense dashboard row.`;

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

function normalizeLane(value) {
  if (value === "actionable") return "needs_attention";
  if (["needs_attention", "fyi", "noise"].includes(value)) return value;
  return "needs_attention";
}

function normalizeCategory(value) {
  return String(value || "uncategorized").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function normalizeUrgency(value) {
  if (["high", "medium", "normal", "low"].includes(value)) return value;
  return "normal";
}

function normalizeEscalationBadge(value, lane) {
  if (lane !== "needs_attention") return null;
  const badge = String(value || "").trim();
  if (!badge || badge.toLowerCase() === "none") return null;
  return badge;
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

function modelUsageFromResult(result, tier) {
  const usage = result?.usage || result?.model_usage || {};
  if (!Object.keys(usage).length) return {};
  return { [tier]: usage };
}

function normalizeModelDecision(result, tier) {
  const decision = result?.decision || result || {};
  const lane = normalizeLane(decision.lane);
  return {
    lane,
    category: normalizeCategory(decision.category),
    urgency: normalizeUrgency(decision.urgency),
    escalation_badge: normalizeEscalationBadge(decision.escalation_badge, lane),
    summary: String(decision.summary || "Needs review."),
    action: String(decision.action || "Review"),
    deadline_at: decision.deadline_at || null,
    confidence: Number.isFinite(Number(decision.confidence))
      ? Number(decision.confidence)
      : null,
    triage_source: tier === "cheap" ? "cheap_model" : "strong_model",
    rule_id: null,
    model_usage: modelUsageFromResult(result, tier),
    estimated_cost_usd: Number.isFinite(Number(result?.estimated_cost_usd))
      ? Number(result.estimated_cost_usd)
      : null,
    latency_ms: Number.isFinite(Number(result?.latency_ms)) ? Number(result.latency_ms) : null,
    cheap_model_result: tier === "cheap" ? result : null,
    strong_model_result: tier === "strong" ? result : null,
    bill_candidate: decision.bill_candidate || result?.bill_candidate || null,
  };
}

function mergeModelUsage(...parts) {
  return Object.assign({}, ...parts.filter(Boolean));
}

function shouldEscalateCheap(decision) {
  if (decision.confidence == null || decision.confidence < CHEAP_CONFIDENCE_FLOOR) return true;
  if (decision.escalation_badge) return true;
  if (decision.urgency === "high") return true;
  if (decision.lane === "needs_attention" && RISK_CATEGORIES.has(decision.category)) return true;
  return false;
}

function fallbackDecision(email, err) {
  return {
    lane: "needs_attention",
    category: "uncategorized",
    urgency: "high",
    escalation_badge: "Needs Review",
    summary: email.body_snippet || email.subject || "Triage failed; review the provider message.",
    action: "Review",
    deadline_at: null,
    confidence: 0,
    triage_source: "failure_fallback",
    rule_id: null,
    model_usage: {},
    estimated_cost_usd: null,
    latency_ms: null,
    cheap_model_result: null,
    strong_model_result: null,
    bill_candidate: null,
    error: err.message,
  };
}

function noModelDecision(email) {
  return {
    lane: "needs_attention",
    category: "uncategorized",
    urgency: "normal",
    escalation_badge: "Needs Review",
    summary: email.body_snippet || email.subject || "Review provider message.",
    action: "Review",
    deadline_at: null,
    confidence: null,
    triage_source: "no_model_fallback",
    rule_id: null,
    model_usage: {},
    estimated_cost_usd: null,
    latency_ms: null,
    cheap_model_result: null,
    strong_model_result: null,
    bill_candidate: null,
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

function compactEmailForPrompt(email, reason) {
  return [
    `Routing reason: ${reason || "none"}`,
    `From: ${email.from_name || ""} <${email.from_address || ""}>`,
    `Subject: ${email.subject || ""}`,
    `Date: ${email.email_date || ""}`,
    "",
    "Snippet:",
    email.body_snippet || "",
    "",
    "Body:",
    String(email.body_text || "").slice(0, 3500),
  ].join("\n");
}

function extractAnthropicToolInput(data) {
  const toolBlock = (data.content || []).find(
    (block) => block.type === "tool_use" && block.name === "submit_email_triage",
  );
  if (!toolBlock?.input) throw new Error("Triage model returned no tool decision");
  return toolBlock.input;
}

function extractOpenAIToolInput(data) {
  for (const item of data.output || []) {
    if (item.type !== "function_call" || item.name !== "submit_email_triage") continue;
    if (typeof item.arguments === "string") return JSON.parse(item.arguments);
    if (item.arguments && typeof item.arguments === "object") return item.arguments;
  }
  throw new Error("Triage model returned no tool decision");
}

function openAITriagePromptCacheKey(tier, model) {
  return `ea-email-triage:${TRIAGE_PROMPT_CACHE_VERSION}:${tier}:${model}`;
}

function cachedTokensFromOpenAIUsage(usage = {}) {
  return Number(
    usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? 0,
  ) || 0;
}

function logOpenAITriageCacheUsage({ tier, model, usage, cacheKey }) {
  console.log(
    `[Email Triage] OpenAI cache tier=${tier} model=${model} `
    + `input=${usage?.input_tokens ?? "?"} output=${usage?.output_tokens ?? "?"} `
    + `cached=${cachedTokensFromOpenAIUsage(usage)} key=${cacheKey}`,
  );
}

function isOpenAICacheParameterError(status, text) {
  return Number(status) === 400 && /prompt_cache_(key|retention)/i.test(String(text || ""));
}

function buildOpenAITriageRequestBody({ model, email, reason, cacheKey, includeCacheFields = true }) {
  return {
    model,
    store: false,
    ...(includeCacheFields
      ? {
          prompt_cache_key: cacheKey,
          prompt_cache_retention: "24h",
        }
      : {}),
    instructions: TRIAGE_SYSTEM_PROMPT,
    input: compactEmailForPrompt(email, reason),
    max_output_tokens: 500,
    reasoning: { effort: "low" },
    tools: [{
      type: "function",
      name: TRIAGE_TOOL.name,
      description: TRIAGE_TOOL.description,
      parameters: TRIAGE_TOOL.input_schema,
      strict: false,
    }],
    tool_choice: { type: "function", name: TRIAGE_TOOL.name },
  };
}

function modelChoiceFromEnv(tier, fallback) {
  const envModel = tier === "cheap"
    ? process.env.EA_TRIAGE_CHEAP_MODEL
    : process.env.EA_TRIAGE_STRONG_MODEL;
  if (!envModel) return fallback;
  return {
    provider: inferEmailAiProviderFromModel(envModel) || fallback.provider,
    model: envModel,
  };
}

function normalizeBillExtractChoice(row = {}) {
  const provider = row.bill_extract_provider || DEFAULT_BILL_EXTRACT_PROVIDER;
  const model = row.bill_extract_model || DEFAULT_BILL_EXTRACT_MODEL;
  if (!isAllowedBillExtractModel(provider, model)) {
    return {
      provider: DEFAULT_BILL_EXTRACT_PROVIDER,
      model: DEFAULT_BILL_EXTRACT_MODEL,
    };
  }
  return { provider, model };
}

async function loadTriageModelConfig(userId, dbClient = db) {
  let row = {};
  try {
    const result = await dbClient.execute({
      sql: `SELECT email_ai_provider, email_ai_model,
                   bill_extract_provider, bill_extract_model
            FROM ea_settings WHERE user_id = ?`,
      args: [userId],
    });
    row = result.rows?.[0] || {};
  } catch {
    row = {};
  }

  const cheap = normalizeBillExtractChoice(row);
  const strong = resolveEmailAiModelConfig({
    provider: row.email_ai_provider,
    model: row.email_ai_model,
  });

  return {
    cheap: modelChoiceFromEnv("cheap", cheap),
    strong: modelChoiceFromEnv("strong", strong),
  };
}

export function createTriageModelClient({
  fetchImpl = fetch,
  config = {
    cheap: { provider: "anthropic", model: DEFAULT_CHEAP_MODEL },
    strong: { provider: "anthropic", model: DEFAULT_STRONG_MODEL },
  },
} = {}) {
  return {
    async classify({ tier, email, reason }) {
      const choice = config[tier] || config.cheap || config.strong;
      if (choice.provider === "openai") {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          const err = new Error("OPENAI_API_KEY not set for triage");
          err.status = 503;
          throw err;
        }
        const started = Date.now();
        const cacheKey = openAITriagePromptCacheKey(tier, choice.model);
        const requestOptions = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(buildOpenAITriageRequestBody({
            model: choice.model,
            email,
            reason,
            cacheKey,
          })),
        };
        let res = await fetchImpl("https://api.openai.com/v1/responses", requestOptions);
        if (!res.ok) {
          const text = await res.text?.();
          if (isOpenAICacheParameterError(res.status, text)) {
            console.warn(
              `[Email Triage] OpenAI cache fields rejected for tier=${tier} model=${choice.model}; `
              + "retrying without cache-only fields",
            );
            res = await fetchImpl("https://api.openai.com/v1/responses", {
              ...requestOptions,
              body: JSON.stringify(buildOpenAITriageRequestBody({
                model: choice.model,
                email,
                reason,
                cacheKey,
                includeCacheFields: false,
              })),
            });
            if (res.ok) {
              const data = await res.json();
              logOpenAITriageCacheUsage({
                tier,
                model: data.model || choice.model,
                usage: data.usage || {},
                cacheKey,
              });
              return {
                decision: extractOpenAIToolInput(data),
                usage: data.usage || {},
                provider: "openai",
                model: data.model || choice.model,
                tier,
                latency_ms: Date.now() - started,
              };
            }
            const retryText = await res.text?.();
            throw new Error(`OpenAI triage API error (${res.status})${retryText ? `: ${retryText}` : ""}`);
          }
          throw new Error(`OpenAI triage API error (${res.status})${text ? `: ${text}` : ""}`);
        }
        const data = await res.json();
        logOpenAITriageCacheUsage({
          tier,
          model: data.model || choice.model,
          usage: data.usage || {},
          cacheKey,
        });
        return {
          decision: extractOpenAIToolInput(data),
          usage: data.usage || {},
          provider: "openai",
          model: data.model || choice.model,
          tier,
          latency_ms: Date.now() - started,
        };
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const err = new Error("ANTHROPIC_API_KEY not set for triage");
        err.status = 503;
        throw err;
      }
      const started = Date.now();
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: choice.model,
          max_tokens: 500,
          system: TRIAGE_SYSTEM_PROMPT,
          tools: [TRIAGE_TOOL],
          tool_choice: { type: "tool", name: "submit_email_triage" },
          messages: [{
            role: "user",
            content: compactEmailForPrompt(email, reason),
          }],
        }),
      });
      if (!res.ok) {
        const text = await res.text?.();
        throw new Error(`Anthropic triage API error (${res.status})${text ? `: ${text}` : ""}`);
      }
      const data = await res.json();
      return {
        decision: extractAnthropicToolInput(data),
        usage: data.usage || {},
        provider: "anthropic",
        model: data.model || choice.model,
        tier,
        latency_ms: Date.now() - started,
      };
    },
  };
}

export function createAnthropicTriageModelClient({
  fetchImpl = fetch,
  cheapModel = DEFAULT_CHEAP_MODEL,
  strongModel = DEFAULT_STRONG_MODEL,
} = {}) {
  return createTriageModelClient({
    fetchImpl,
    config: {
      cheap: { provider: "anthropic", model: cheapModel },
      strong: { provider: "anthropic", model: strongModel },
    },
  });
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
    return { decision: preflightDecision, modelCalls };
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
      },
      modelCalls,
    };
  }

  const cheap = await classifyWithModel(getModelClient, "cheap", email, preflight.reasonCode);
  modelCalls.push("cheap");
  if (!shouldEscalateCheap(cheap)) {
    return {
      decision: {
        ...cheap,
        decision_metadata: metadata,
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
  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'running',
              attempts = attempts + 1,
              locked_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND status = 'queued'`,
    args: [nowIso(now), job.id],
  });
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
  });

  return classifyAfter;
}

function weakSecurityReadDecision() {
  return {
    lane: "fyi",
    category: "security",
    urgency: "low",
    escalation_badge: null,
    summary: "Security notification was read during the grace window.",
    action: "No action needed.",
    deadline_at: null,
    confidence: 0.86,
    triage_source: "weak_security_grace_read",
    rule_id: null,
    model_usage: {},
    estimated_cost_usd: null,
    latency_ms: null,
    cheap_model_result: null,
    strong_model_result: null,
    bill_candidate: null,
    decision_metadata: {
      weakSecurityGrace: {
        outcome: "read_in_inbox",
        modelSaved: true,
      },
    },
  };
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
    decision = fallbackDecision(email, err);
    status = "failed";
  }

  await updateTriageRow(email, decision, {
    dbClient,
    now,
    status,
    inferBillCandidate: mode.effective_email_triage_mode !== "no_model",
  });
  await attachToActiveSnapshot(email, decision, { dbClient, now });
  await completeJob(job, dbClient, now, status === "failed" ? decision.error : "");
  publishCurrentDashboardEvent(email.user_id, {
    source: "email_triage",
    reason: status === "failed" ? "email_triage_failed" : "email_triage_finalized",
    state: "current",
    occurredAt: nowIso(now),
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
