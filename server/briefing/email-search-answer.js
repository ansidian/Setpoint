import { retrieveInboxAiSearch } from "./email-search-retrieval.js";
import { createInboxAiQueryPlan } from "./email-search-planner.js";
import {
  estimateTokensFromText,
  recordEmailSearchAiUsage,
} from "./email-search-cost-stats.js";
import { EMAIL_SEARCH_EMBEDDING_MODEL } from "./email-search-embeddings.js";

export const INBOX_AI_SEARCH_MODEL = "gpt-5.4-mini";
export const INBOX_AI_SOURCE_BODY_CHAR_LIMIT = 1200;
const MAX_AI_SOURCE_ROWS = 8;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function senderFor(candidate) {
  const name = clean(candidate.from?.name);
  const address = clean(candidate.from?.address);
  if (name && address) return `${name} <${address}>`;
  return name || address;
}

function emailFromUid(uid) {
  const text = clean(uid);
  if (!text.startsWith("gmail-")) return "";
  const withoutProvider = text.slice("gmail-".length);
  const accountId = withoutProvider.replace(/-[^-]+$/, "");
  const emailish = accountId.startsWith("gmail-")
    ? accountId.slice("gmail-".length)
    : accountId;
  return emailish.includes("@") ? emailish : "";
}

function sourceLabelFor(candidate) {
  const account = candidate.account || {};
  const label = clean(account.label || account.name || account.account_label);
  const email = clean(account.email || account.account_email) || emailFromUid(candidate.uid);
  if (label && email && label.toLowerCase() !== email.toLowerCase()) {
    return `${label} (${email})`;
  }
  return label || email || clean(candidate.uid);
}

function sourceRow(candidate) {
  return {
    uid: candidate.uid,
    source_label: sourceLabelFor(candidate),
    sender: senderFor(candidate),
    subject: clean(candidate.subject),
    date: candidate.email_date || null,
    read: !!candidate.read,
    snippet: clean(candidate.body_snippet),
    body_excerpt: clean(candidate.body_excerpt).slice(0, INBOX_AI_SOURCE_BODY_CHAR_LIMIT),
    metadata: candidate.metadata || {},
    provenance: candidate.provenance || {},
    scores: candidate.scores || {},
    account: candidate.account || {},
  };
}

async function safeRecordUsage(recordUsage, userId, payload) {
  try {
    await recordUsage?.(userId, payload);
  } catch (err) {
    console.warn("[EA] Failed to record inbox AI search usage:", err.message);
  }
}

export async function answerInboxAiSearch(userId, {
  q,
  limit,
  retrieve = retrieveInboxAiSearch,
  planner = createInboxAiQueryPlan,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.OPENAI_API_KEY,
  model = INBOX_AI_SEARCH_MODEL,
  recordUsage = recordEmailSearchAiUsage,
  debug = false,
} = {}) {
  let plannerResult = null;
  let plan = null;
  try {
    plannerResult = planner
      ? await planner({ q, fetchImpl, apiKey, model })
      : { status: "skipped", plan: null };
    plan = plannerResult.plan || null;
  } catch (err) {
    plannerResult = {
      status: "fallback",
      error_class: err?.code || err?.name || "inbox_ai_planner_error",
    };
  }
  if (plannerResult?.status === "ok") {
    await safeRecordUsage(recordUsage, userId, {
      eventType: "planner",
      model: plannerResult.model || model,
      usage: plannerResult.usage || {},
      metadata: {
        planned: !!plan,
      },
    });
  }
  const retrieveOptions = { q, limit };
  if (plan) retrieveOptions.plan = plan;
  const retrieval = await retrieve(userId, retrieveOptions);
  if (retrieval?.vector?.status === "ok") {
    const vectorQuery = plan?.semantic_query || q;
    await safeRecordUsage(recordUsage, userId, {
      eventType: "query_embedding",
      model: EMAIL_SEARCH_EMBEDDING_MODEL,
      usage: {
        input_tokens: estimateTokensFromText(vectorQuery),
        output_tokens: 0,
      },
      estimated: true,
      metadata: {
        retrieval_mode: retrieval.mode,
        vector_status: retrieval.vector.status,
      },
    });
  }
  const sources = (retrieval.candidates || []).slice(0, MAX_AI_SOURCE_ROWS);
  const answerSources = sources.map(sourceRow);
  const retrievalSummary = {
    mode: retrieval.mode,
    vector_status: retrieval.vector?.status || "unknown",
    lexical_status: retrieval.lexical?.status || "unknown",
    total_candidates: retrieval.total ?? sources.length,
    date_window: retrieval.parsed_query?.date_window || plan?.date_window || null,
  };

  if (!sources.length) {
    const response = {
      answer_status: "no_sources",
      answer: null,
      sources: [],
      retrieval: retrievalSummary,
    };
    if (debug) response.planner = plannerResult;
    return response;
  }

  const result = {
    answer_status: "ok",
    answer: null,
    sources: answerSources,
    retrieval: retrievalSummary,
  };
  if (debug) result.planner = plannerResult;
  return result;
}
