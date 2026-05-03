import db from "../db/connection.js";
import { getOrCreateActiveSnapshot } from "./snapshot-service.js";
import { resolveEmailAiModelConfig, inferEmailAiProviderFromModel } from "./email-ai-models.js";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
  isAllowedBillExtractModel,
} from "./bill-extractors/catalog.js";

const CHEAP_CONFIDENCE_FLOOR = 0.72;
const RISK_CATEGORIES = new Set(["finance", "security", "legal", "school"]);
const DEFAULT_CHEAP_MODEL = DEFAULT_BILL_EXTRACT_MODEL;
const DEFAULT_STRONG_MODEL = "claude-sonnet-4-6";

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
          "updates",
          "marketing",
          "uncategorized",
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
- needs_attention: requires a user response, decision, payment, deadline handling, security/legal/school/finance review, or any risky ambiguity.
- fyi: useful real account activity, confirmations, receipts, statements, shipping, or context that does not require action.
- noise: promotions, newsletters, surveys, coupons, generic marketing, and low-value bulk mail.

Rules:
- Use exactly one lane: needs_attention, fyi, noise.
- Categories are metadata, not lanes.
- Escalation is a badge/status, not a lane.
- If a specific deadline or due date exists, set deadline_at as an ISO timestamp or null if uncertain.
- Finance/payment bill candidates must require confirmation; never imply an Actual Budget write.
- Be compact. Summary and action should each be short enough for a dense dashboard row.`;

const DEFAULT_RULES = [
  {
    name: "High-risk finance and security direct strong",
    priority: 10,
    rule_type: "default_high_risk",
    match_json: {
      any_includes: [
        "payment due",
        "past due",
        "overdue",
        "security alert",
        "password reset",
        "account recovery",
        "password changed",
        "new sign-in",
        "new login",
        "new device registration",
        "unrecognized sign-in",
        "suspicious sign-in",
        "third-party oauth application",
        "legal notice",
        "tax document",
        "tuition",
        "registration deadline",
        "canvas assignment",
      ],
    },
    route_to_model: "strong",
    category: "finance",
    urgency: "high",
    escalation_badge: "High Risk",
    confidence: 0.9,
    reason: "High-risk sender or content requires strong-model review.",
  },
  {
    name: "Low-risk FYI confirmations",
    priority: 40,
    rule_type: "default_fyi",
    match_json: {
      any_includes: [
        "statement available",
        "receipt",
        "order confirmation",
        "delivered",
        "shipped",
        "appointment confirmed",
      ],
    },
    lane: "fyi",
    category: "updates",
    urgency: "low",
    confidence: 0.86,
    reason: "Low-risk confirmation or account update.",
  },
  {
    name: "Ephemeral verification codes",
    priority: 60,
    rule_type: "default_verification_code_noise",
    match_json: {
      any_includes: [
        "verification code",
        "one-time code",
        "one time code",
        "one-time passcode",
        "one time passcode",
        "authentication code",
        "sign-in code",
        "login code",
        "2fa code",
        "mfa code",
        "enter the following code",
        "code will expire",
        "e-mail verification",
      ],
    },
    lane: "noise",
    category: "security",
    urgency: "low",
    confidence: 0.96,
    reason: "One-time authentication code.",
  },
  {
    name: "Promotional subject lines",
    priority: 70,
    rule_type: "default_subject_marketing_noise",
    match_json: {
      subject_includes: [
        "promo code",
        "coupon",
        "deal of the day",
        "free shipping",
        "clearance",
        "bogo",
        "buy one, get one",
        "flash sale",
        "earn points",
        "bonus points",
        "rewards offer",
      ],
    },
    lane: "noise",
    category: "marketing",
    urgency: "low",
    confidence: 0.94,
    reason: "Promotional subject line.",
  },
  {
    name: "Obvious promotional noise",
    priority: 80,
    rule_type: "default_noise",
    match_json: {
      any_includes: [
        "unsubscribe",
        "sale",
        "discount",
        "% off",
        "newsletter",
        "survey",
        "promotion",
        "limited time offer",
      ],
    },
    lane: "noise",
    category: "marketing",
    urgency: "low",
    confidence: 0.94,
    reason: "Promotional or bulk email.",
  },
];

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

function includesAny(text, needles = []) {
  return needles.some((needle) => text.includes(toText(needle)));
}

function domainFromAddress(address) {
  const [, domain = ""] = String(address || "").toLowerCase().split("@");
  return domain;
}

function matchesRule(email, rule) {
  const match = typeof rule.match_json === "string"
    ? safeJson(rule.match_json)
    : rule.match_json || {};
  const allText = emailSearchText(email);
  const fromAddress = toText(email.from_address);
  const fromDomain = domainFromAddress(email.from_address);

  if (match.from_addresses?.length && !match.from_addresses.map(toText).includes(fromAddress)) {
    return false;
  }
  if (match.from_domains?.length && !match.from_domains.map(toText).includes(fromDomain)) {
    return false;
  }
  if (match.subject_includes?.length && !includesAny(toText(email.subject), match.subject_includes)) {
    return false;
  }
  if (match.body_includes?.length && !includesAny(toText(`${email.body_snippet}\n${email.body_text}`), match.body_includes)) {
    return false;
  }
  if (match.any_includes?.length && !includesAny(allText, match.any_includes)) {
    return false;
  }

  return Boolean(
    match.from_addresses?.length
    || match.from_domains?.length
    || match.subject_includes?.length
    || match.body_includes?.length
    || match.any_includes?.length
  );
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

function ruleDecision(rule) {
  const lane = normalizeLane(rule.lane);
  if (lane === "needs_attention") {
    return {
      route: "strong",
      reason: rule.reason || "Rule matched Needs Attention; routing to strong model.",
    };
  }
  return {
    route: "rule",
    decision: {
      lane,
      category: normalizeCategory(rule.category),
      urgency: normalizeUrgency(rule.urgency),
      escalation_badge: rule.escalation_badge || null,
      summary: rule.reason || "Matched triage rule.",
      action: lane === "noise" ? "Ignore" : "Review when convenient",
      deadline_at: null,
      confidence: Number(rule.confidence || 0.8),
      triage_source: "rule",
      rule_id: rule.id || null,
      model_usage: {},
      estimated_cost_usd: null,
      latency_ms: null,
      cheap_model_result: null,
      strong_model_result: null,
      bill_candidate: null,
    },
  };
}

function routeFromRules(email, rules) {
  for (const rule of rules) {
    if (!matchesRule(email, rule)) continue;
    const routeToModel = rule.route_to_model === "strong" ? "strong" : null;
    if (routeToModel) {
      return {
        route: routeToModel,
        rule,
        reason: rule.reason || "Rule matched high-risk routing.",
      };
    }
    const decision = ruleDecision(rule);
    return { ...decision, rule };
  }
  return { route: "cheap", reason: "No deterministic rule matched." };
}

async function loadRules(userId, dbClient) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_triage_rules
          WHERE user_id = ? AND enabled = 1
          ORDER BY priority ASC, id ASC`,
    args: [userId],
  });
  return [
    ...result.rows,
    ...DEFAULT_RULES,
  ].sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
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
      sql: `SELECT email_ai_provider, email_ai_model, claude_model,
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
    legacyModel: row.claude_model || DEFAULT_STRONG_MODEL,
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
        const res = await fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: choice.model,
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
          }),
        });
        if (!res.ok) {
          const text = await res.text?.();
          throw new Error(`OpenAI triage API error (${res.status})${text ? `: ${text}` : ""}`);
        }
        const data = await res.json();
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
  const rules = await loadRules(email.user_id, dbClient);
  const routed = routeFromRules(email, rules);
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

  if (routed.route === "rule") {
    return {
      decision: {
        ...routed.decision,
        rule_id: routed.rule?.id || null,
      },
      modelCalls,
    };
  }

  if (routed.route === "strong") {
    const strong = await classifyWithModel(getModelClient, "strong", email, routed.reason);
    modelCalls.push("strong");
    return {
      decision: {
        ...strong,
        rule_id: routed.rule?.id || null,
      },
      modelCalls,
    };
  }

  const cheap = await classifyWithModel(getModelClient, "cheap", email, routed.reason);
  modelCalls.push("cheap");
  if (!shouldEscalateCheap(cheap)) {
    return { decision: cheap, modelCalls };
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

async function loadEmailForJob(job, dbClient) {
  const result = await dbClient.execute({
    sql: `SELECT t.id AS triage_id,
                 t.triage_status,
                 t.last_triaged_at,
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
                 i.read
          FROM ea_email_triage t
          LEFT JOIN ea_email_index i
            ON i.uid = t.email_id
           AND i.user_id = t.user_id
           AND i.account_id = t.account_id
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
} = {}) {
  const billCandidate = maybeBillCandidate(email, decision);
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
             account_color_at_snapshot, account_icon_at_snapshot, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    ],
  });
}

async function completeJob(job, dbClient, now, lastError = "") {
  await dbClient.execute({
    sql: `UPDATE ea_triage_jobs
          SET status = 'complete',
              completed_at = ?,
              last_error = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [nowIso(now), lastError, job.id],
  });
}

export async function processNextEmailTriageJob({
  dbClient = db,
  modelClient,
  now = new Date(),
} = {}) {
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
    const routed = await routeEmailForTriage(email, { dbClient, modelClient });
    decision = routed.decision;
    modelCalls = routed.modelCalls;
  } catch (err) {
    decision = fallbackDecision(email, err);
    status = "failed";
  }

  await updateTriageRow(email, decision, { dbClient, now, status });
  await attachToActiveSnapshot(email, decision, { dbClient, now });
  await completeJob(job, dbClient, now, status === "failed" ? decision.error : "");

  return {
    processed: true,
    job_id: Number(job.id),
    email_id: email.email_id,
    lane: decision.lane,
    source: decision.triage_source,
    model_calls: modelCalls,
  };
}
