import { retrieveInboxAiSearch } from "./email-search-retrieval.js";
import { createInboxAiQueryPlan } from "./email-search-planner.js";
import {
  estimateTokensFromText,
  recordEmailSearchAiUsage,
} from "./email-search-cost-stats.js";
import { EMAIL_SEARCH_EMBEDDING_MODEL } from "./email-search-embeddings.js";

export const INBOX_AI_ANSWER_MODEL = "gpt-5.4-mini";
export const INBOX_AI_ANSWER_BODY_CHAR_LIMIT = 1200;
const MAX_ANSWER_SOURCES = 8;
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    cited_source_uids: {
      type: "array",
      items: { type: "string" },
    },
    missing_info: {
      type: "array",
      items: { type: "string" },
    },
    low_confidence_reason: { type: "string" },
  },
  required: ["answer", "confidence", "cited_source_uids", "missing_info", "low_confidence_reason"],
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    body_excerpt: clean(candidate.body_excerpt).slice(0, INBOX_AI_ANSWER_BODY_CHAR_LIMIT),
    metadata: candidate.metadata || {},
    provenance: candidate.provenance || {},
    scores: candidate.scores || {},
    account: candidate.account || {},
  };
}

export function buildInboxAiAnswerPayload({
  query,
  candidates,
  dateWindow = null,
  maxSources = MAX_ANSWER_SOURCES,
} = {}) {
  return {
    query,
    date_window: dateWindow,
    sources: (candidates || []).slice(0, maxSources).map(sourceRow),
  };
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

function answerError(message, code = "inbox_ai_answer_invalid_output", status = 502) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

async function safeRecordUsage(recordUsage, userId, payload) {
  try {
    await recordUsage?.(userId, payload);
  } catch (err) {
    console.warn("[EA] Failed to record inbox AI search usage:", err.message);
  }
}

function labelMapFromAllowedSources(allowedSources) {
  if (allowedSources instanceof Map) return allowedSources;
  return new Map([...allowedSources].map((uid) => [uid, uid]));
}

function replaceRawSourceUids(answer, sourceLabelsByUid) {
  let nextAnswer = answer;
  for (const [uid, label] of sourceLabelsByUid.entries()) {
    if (!uid || !label || uid === label) continue;
    nextAnswer = nextAnswer.replace(new RegExp(escapeRegExp(uid), "g"), label);
  }
  return nextAnswer;
}

export function parseInboxAiAnswerOutput(output, allowedSources) {
  const parsed = typeof output === "string" ? JSON.parse(output) : output;
  const cited = parsed?.cited_source_uids;
  const sourceLabelsByUid = labelMapFromAllowedSources(allowedSources || new Set());
  if (
    !parsed
    || typeof parsed.answer !== "string"
    || !parsed.answer.trim()
    || !VALID_CONFIDENCE.has(parsed.confidence)
    || !Array.isArray(cited)
    || !Array.isArray(parsed.missing_info)
    || typeof parsed.low_confidence_reason !== "string"
  ) {
    throw answerError("Invalid inbox AI answer structured output");
  }

  return {
    answer: replaceRawSourceUids(parsed.answer.trim(), sourceLabelsByUid),
    confidence: parsed.confidence,
    cited_source_uids: cited.filter((uid) => sourceLabelsByUid.has(uid)),
    missing_info: parsed.missing_info.map(clean).filter(Boolean),
    low_confidence_reason: clean(parsed.low_confidence_reason),
  };
}

async function callOpenAiAnswer({ apiKey, fetchImpl, model, payload }) {
  if (!apiKey) {
    throw answerError(
      "OPENAI_API_KEY not set for inbox AI answer",
      "inbox_ai_answer_unavailable",
      503,
    );
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
        "Answer the user's inbox question using only the provided indexed email sources.",
        "Use source_label, not uid, when naming sources in the answer text.",
        "Return cited_source_uids for factual claims. If the sources are incomplete, say what is missing.",
        "If date_window is present, do not count or cite messages outside that window.",
        "Do not invent actions, provider state, or facts not grounded in the sources.",
      ].join("\n"),
      input: JSON.stringify(payload),
      store: false,
      max_output_tokens: 500,
      text: {
        format: {
          type: "json_schema",
          name: "inbox_ai_answer",
          schema: ANSWER_SCHEMA,
          strict: true,
        },
      },
    }),
  });
  if (!response.ok) {
    throw answerError(
      `OpenAI answer request failed (${response.status})`,
      "inbox_ai_answer_provider_error",
      502,
    );
  }
  const data = await response.json();
  const text = outputText(data);
  if (!text) throw answerError("OpenAI answer response did not include output_text");
  return {
    output: text,
    usage: data.usage || {},
    model: data.model || model,
  };
}

export async function answerInboxAiSearch(userId, {
  q,
  limit,
  retrieve = retrieveInboxAiSearch,
  planner = createInboxAiQueryPlan,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.OPENAI_API_KEY,
  model = INBOX_AI_ANSWER_MODEL,
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
  const sources = (retrieval.candidates || []).slice(0, MAX_ANSWER_SOURCES);
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

  try {
    const payload = buildInboxAiAnswerPayload({
      query: q,
      candidates: sources,
      dateWindow: retrievalSummary.date_window,
    });
    const response = await callOpenAiAnswer({ apiKey, fetchImpl, model, payload });
    await safeRecordUsage(recordUsage, userId, {
      eventType: "answer",
      model: response.model,
      usage: response.usage || {},
      metadata: {
        source_count: sources.length,
        retrieval_mode: retrieval.mode,
        vector_status: retrieval.vector?.status || "unknown",
        lexical_status: retrieval.lexical?.status || "unknown",
      },
    });
    const answer = parseInboxAiAnswerOutput(
      response.output,
      new Map(answerSources.map((source) => [source.uid, source.source_label || source.uid])),
    );
    const result = {
      answer_status: "ok",
      answer,
      sources: answerSources,
      retrieval: retrievalSummary,
      debug: {
        model: response.model,
        usage: response.usage,
      },
    };
    if (debug) result.planner = plannerResult;
    return result;
  } catch (err) {
    const result = {
      answer_status: "error",
      answer: null,
      answer_error: {
        code: err?.code || "inbox_ai_answer_error",
        status: err?.status || 500,
      },
      sources: answerSources,
      retrieval: retrievalSummary,
    };
    if (debug) result.planner = plannerResult;
    return result;
  }
}
