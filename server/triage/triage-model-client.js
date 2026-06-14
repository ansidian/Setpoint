import db from "../db/connection.js";
import { resolveEmailAiModelConfig, inferEmailAiProviderFromModel } from "../email/email-ai-models.js";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
  isAllowedBillExtractModel,
} from "../bills/bill-extractors/catalog.js";

const DEFAULT_CHEAP_MODEL = DEFAULT_BILL_EXTRACT_MODEL;
const DEFAULT_STRONG_MODEL = "claude-sonnet-4-6";
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

export async function loadTriageModelConfig(userId, dbClient = db) {
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
