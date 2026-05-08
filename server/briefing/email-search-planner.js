import { parseEmailSearchQuery } from "./email-search-query.js";

export const INBOX_AI_PLANNER_MODEL = "gpt-5.4-mini";
const READ_FILTERS = new Set(["read", "unread"]);
const LANES = new Set(["needs_attention", "action", "fyi", "noise", "untriaged"]);
const URGENCY = new Set(["high", "medium", "normal", "low"]);
const CATEGORIES = new Set(["finance", "bills", "school", "security", "work", "travel", "health", "legal", "delivery", "infra", "personal", "uncategorized"]);
const MAX_LIST = 3;
const MAX_FILTER_LIST = 5;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    semantic_query: { type: "string" },
    lexical_queries: { type: "array", items: { type: "string" } },
    sender_domains: { type: "array", items: { type: "string" } },
    sender_addresses: { type: "array", items: { type: "string" } },
    read_filter: { type: ["string", "null"], enum: ["read", "unread", null] },
    date_window: {
      type: "object",
      additionalProperties: false,
      properties: {
        after: { type: ["string", "null"] },
        before: { type: ["string", "null"] },
      },
      required: ["after", "before"],
    },
    lanes: { type: "array", items: { type: "string" } },
    categories: { type: "array", items: { type: "string" } },
    urgency: { type: "array", items: { type: "string" } },
    intents: { type: "array", items: { type: "string" } },
    exclusions: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
  required: ["semantic_query", "lexical_queries", "sender_domains", "sender_addresses", "read_filter", "date_window", "lanes", "categories", "urgency", "intents", "exclusions", "confidence"],
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cappedStrings(values, { limit = MAX_LIST, pattern = null, normalize = (value) => value } = {}) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalize(clean(value).toLowerCase());
    if (!normalized) continue;
    if (pattern && !pattern.test(normalized)) continue;
    if (!out.includes(normalized)) out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function isoOrNull(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output || []) {
    if (item.type !== "message") continue;
    for (const block of item.content || []) {
      if (block.type === "output_text" && typeof block.text === "string") return block.text;
    }
  }
  return "";
}

export function parseInboxAiRetrievalPlan(rawPlan, { explicitReadFilter = null } = {}) {
  const plan = typeof rawPlan === "string" ? JSON.parse(rawPlan) : rawPlan || {};
  const readFilter = explicitReadFilter != null
    ? (explicitReadFilter === 1 ? "read" : "unread")
    : (READ_FILTERS.has(plan.read_filter) ? plan.read_filter : null);
  return {
    semantic_query: clean(plan.semantic_query),
    lexical_queries: cappedStrings(plan.lexical_queries),
    sender_domains: cappedStrings(plan.sender_domains, {
      limit: MAX_FILTER_LIST,
      pattern: /^[a-z0-9.-]+\.[a-z]{2,}$/,
    }),
    sender_addresses: cappedStrings(plan.sender_addresses, {
      limit: MAX_FILTER_LIST,
      pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
    }),
    read_filter: readFilter,
    date_window: {
      after: isoOrNull(plan.date_window?.after),
      before: isoOrNull(plan.date_window?.before),
    },
    lanes: cappedStrings(plan.lanes, { values: LANES }).filter((value) => LANES.has(value)),
    categories: cappedStrings(plan.categories).filter((value) => CATEGORIES.has(value)),
    urgency: cappedStrings(plan.urgency).filter((value) => URGENCY.has(value)),
    intents: cappedStrings(plan.intents),
    exclusions: cappedStrings(plan.exclusions),
    confidence: Math.max(0, Math.min(1, Number(plan.confidence) || 0)),
    ...(explicitReadFilter != null ? { explicit_read_filter: true } : {}),
  };
}

export async function createInboxAiQueryPlan({
  q,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.OPENAI_API_KEY,
  model = INBOX_AI_PLANNER_MODEL,
} = {}) {
  const { textQuery, readFilter } = parseEmailSearchQuery(q);
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY not set for inbox AI planner");
    err.status = 503;
    err.code = "inbox_ai_planner_unavailable";
    throw err;
  }
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: [
        "Create a safe retrieval plan for local indexed inbox search. Return JSON only. Do not write SQL.",
        "Keep semantic_query close to the user's wording and preserve ambiguity for overloaded terms.",
        "Do not assume a brand, sender, category, urgency, or exclusion unless the user explicitly names it.",
        "Example: for 'prime promo', search broadly for Prime promo, Prime Visa, Prime Video, Amazon Prime, and promotional credit; do not narrow to Amazon-only.",
      ].join("\n"),
      input: JSON.stringify({ query: q, text_query_without_flags: textQuery }),
      store: false,
      max_output_tokens: 350,
      text: {
        format: {
          type: "json_schema",
          name: "inbox_ai_retrieval_plan",
          schema: PLAN_SCHEMA,
          strict: true,
        },
      },
    }),
  });
  if (!response.ok) {
    const err = new Error(`OpenAI planner request failed (${response.status})`);
    err.status = 502;
    err.code = "inbox_ai_planner_provider_error";
    throw err;
  }
  const data = await response.json();
  const text = outputText(data);
  if (!text) {
    const err = new Error("OpenAI planner response did not include output_text");
    err.status = 502;
    err.code = "inbox_ai_planner_invalid_output";
    throw err;
  }
  return {
    status: "ok",
    plan: parseInboxAiRetrievalPlan(text, { explicitReadFilter: readFilter }),
    model: data.model || model,
    usage: data.usage || {},
  };
}
