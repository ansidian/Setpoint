import db from "../db/connection.ts";
import { resolveEmailAiModelConfig, inferEmailAiProviderFromModel } from "../email/email-ai-models.ts";
import {
  DEFAULT_BILL_EXTRACT_MODEL,
  resolveBillExtractModelConfig,
} from "../bills/bill-extractors/catalog.ts";
import { createBillCandidateVerificationService } from "../bills/bill-candidate-verification-service.ts";
import { BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS } from "../bills/bill-semantic-prompt.ts";
import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import { resolveAiApiKey, type AiProvider } from "../ai-credentials.ts";
import type {
  TriageDb,
  TriageEmail,
  TriageError,
  TriageFetch,
  TriageFetchResponse,
  TriageModelChoice,
  TriageModelClient,
  TriageModelConfig,
  TriageModelResult,
  TriageModelTier,
  TriageModelUsage,
} from "./triage-types.ts";
import {
  BILL_AMOUNT_KINDS,
  BILL_EVENT_KINDS,
  type BillCandidate,
  type BillExtractionProvider,
} from "../../shared/types/bills.ts";

const DEFAULT_CHEAP_MODEL = DEFAULT_BILL_EXTRACT_MODEL;
const DEFAULT_STRONG_MODEL = "claude-sonnet-4-6";
const TRIAGE_PROMPT_CACHE_VERSION = "v7";
// LLM completions legitimately run long; this deadline is a wedge-breaker
// (guards against a hung connection), not a latency budget.
const TRIAGE_MODEL_TIMEOUT_MS = 120_000;

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
          amount_kind: { type: ["string", "null"], enum: [...BILL_AMOUNT_KINDS, null] },
          amount_candidates: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: BILL_AMOUNT_KINDS },
                value: { type: "number" },
                evidence: { type: ["string", "null"] },
                confidence: { type: ["number", "null"] },
              },
              required: ["kind", "value", "evidence", "confidence"],
            },
          },
          event_kind: { type: "string", enum: BILL_EVENT_KINDS },
          event_confidence: { type: "number" },
          event_evidence: { type: "string" },
          account_last4: { type: ["string", "null"], pattern: "^[0-9]{4}$" },
          account_last4_evidence: { type: ["string", "null"] },
          account_last4_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          target_policy_key: { type: ["string", "null"] },
          target_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          target_evidence: { type: ["string", "null"] },
          due_date: { type: ["string", "null"] },
          currency: { type: ["string", "null"] },
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
${BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS}
- Be compact. Summary and action should each be short enough for a dense dashboard row.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function compactEmailForPrompt(email: Partial<TriageEmail>, reason: string): string {
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

function extractAnthropicToolInput(data: unknown): Record<string, unknown> {
  const source = isRecord(data) ? data : {};
  const toolBlock = recordArray(source.content).find(
    (block) => block.type === "tool_use" && block.name === "submit_email_triage",
  );
  if (!isRecord(toolBlock?.input)) throw new Error("Triage model returned no tool decision");
  return toolBlock.input;
}

function extractOpenAIToolInput(data: unknown): Record<string, unknown> {
  const source = isRecord(data) ? data : {};
  for (const item of recordArray(source.output)) {
    if (item.type !== "function_call" || item.name !== "submit_email_triage") continue;
    if (typeof item.arguments === "string") {
      const parsed: unknown = JSON.parse(item.arguments);
      if (isRecord(parsed)) return parsed;
    }
    if (isRecord(item.arguments)) return item.arguments;
  }
  throw new Error("Triage model returned no tool decision");
}

function openAITriagePromptCacheKey(tier: TriageModelTier, model: string): string {
  return `ea-email-triage:${TRIAGE_PROMPT_CACHE_VERSION}:${tier}:${model}`;
}

function cachedTokensFromOpenAIUsage(usage: TriageModelUsage = {}): number {
  return Number(
    usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? 0,
  ) || 0;
}

function logOpenAITriageCacheUsage({ tier, model, usage, cacheKey }: { tier: TriageModelTier; model: string; usage: TriageModelUsage; cacheKey: string }): void {
  console.log(
    `[Email Triage] OpenAI cache tier=${tier} model=${model} `
    + `input=${usage?.input_tokens ?? "?"} output=${usage?.output_tokens ?? "?"} `
    + `cached=${cachedTokensFromOpenAIUsage(usage)} key=${cacheKey}`,
  );
}

function logAnthropicTriageCacheUsage({ tier, model, usage }: { tier: TriageModelTier; model: string; usage: TriageModelUsage }): void {
  console.log(
    `[Email Triage] Anthropic cache tier=${tier} model=${model} `
    + `input=${usage?.input_tokens ?? "?"} output=${usage?.output_tokens ?? "?"} `
    + `cache_read=${Number(usage?.cache_read_input_tokens ?? 0) || 0} `
    + `cache_creation=${Number(usage?.cache_creation_input_tokens ?? 0) || 0}`,
  );
}

function isOpenAICacheParameterError(status: number, text: unknown): boolean {
  return Number(status) === 400 && /prompt_cache_(key|retention)/i.test(String(text || ""));
}

function buildOpenAITriageRequestBody({ model, email, reason, cacheKey, includeCacheFields = true }: { model: string; email: Partial<TriageEmail>; reason: string; cacheKey: string; includeCacheFields?: boolean }): Record<string, unknown> {
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

function modelChoiceFromEnv(tier: TriageModelTier, fallback: TriageModelChoice): TriageModelChoice {
  const envModel = tier === "cheap"
    ? process.env.EA_TRIAGE_CHEAP_MODEL
    : process.env.EA_TRIAGE_STRONG_MODEL;
  if (!envModel) return fallback;
  return {
    provider: inferEmailAiProviderFromModel(envModel) || fallback.provider,
    model: envModel,
  };
}

function normalizeBillExtractChoice(row: Record<string, unknown> = {}): TriageModelChoice {
  return resolveBillExtractModelConfig({
    provider: row.bill_extract_provider,
    model: row.bill_extract_model,
  });
}

async function verifyTriageBillAmounts({
  decision,
  email,
  providerId,
  model,
  service,
}: {
  decision: Record<string, unknown>;
  email: Partial<TriageEmail>;
  providerId: string;
  model: string;
  service: ReturnType<typeof createBillCandidateVerificationService>;
}): Promise<Record<string, unknown>> {
  if (!isRecord(decision.bill_candidate)) return decision;
  const candidate = await service.verifyEmailCandidate({
    email: {
      subject: email.subject,
      from: email.from_address,
      body: email.body_text,
      body_snippet: email.body_snippet,
    },
    candidate: decision.bill_candidate as BillCandidate,
    providerId,
    model,
  });
  return { ...decision, bill_candidate: candidate };
}

export async function loadTriageModelConfig(userId: string, dbClient: TriageDb = db as unknown as TriageDb): Promise<TriageModelConfig> {
  let row: Record<string, unknown> = {};
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
  credentialResolver = resolveAiApiKey,
  billExtractionProviders,
  config = {
    cheap: { provider: "anthropic", model: DEFAULT_CHEAP_MODEL },
    strong: { provider: "anthropic", model: DEFAULT_STRONG_MODEL },
  },
}: {
  fetchImpl?: unknown;
  config?: TriageModelConfig;
  credentialResolver?: (provider: AiProvider) => Promise<string | null>;
  billExtractionProviders?: Partial<Record<"openai" | "anthropic", BillExtractionProvider>>;
} = {}): TriageModelClient {
  const fetchFn = fetchImpl as TriageFetch;
  const billCandidateVerification = createBillCandidateVerificationService({
    credentialResolver,
    providers: billExtractionProviders,
  });
  const verifyDecision = (
    decision: Record<string, unknown>,
    email: Partial<TriageEmail>,
  ) => {
    const choice = config.cheap;
    const providerId = choice.provider === "openai" ? "openai" : "anthropic";
    return verifyTriageBillAmounts({
      decision,
      email,
      providerId,
      model: choice.model,
      service: billCandidateVerification,
    });
  };
  return {
    async classify({ tier, email, reason }): Promise<TriageModelResult> {
      const choice = config[tier] || config.cheap || config.strong;
      if (choice.provider === "openai") {
        const apiKey = await credentialResolver("openai");
        if (!apiKey) {
          const err = new Error("OPENAI_API_KEY not set for triage") as TriageError;
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
        let res = await fetchWithTimeout<TriageFetchResponse>("https://api.openai.com/v1/responses", requestOptions, {
          timeoutMs: TRIAGE_MODEL_TIMEOUT_MS,
          fetchFn,
        });
        if (!res.ok) {
          const text = await res.text?.();
          if (isOpenAICacheParameterError(res.status, text)) {
            console.warn(
              `[Email Triage] OpenAI cache fields rejected for tier=${tier} model=${choice.model}; `
              + "retrying without cache-only fields",
            );
            res = await fetchWithTimeout("https://api.openai.com/v1/responses", {
              ...requestOptions,
              body: JSON.stringify(buildOpenAITriageRequestBody({
                model: choice.model,
                email,
                reason,
                cacheKey,
                includeCacheFields: false,
              })),
            }, { timeoutMs: TRIAGE_MODEL_TIMEOUT_MS, fetchFn });
            if (res.ok) {
              const data = await res.json();
              const source = isRecord(data) ? data : {};
              const usage = isRecord(source.usage) ? source.usage as TriageModelUsage : {};
              const responseModel = typeof source.model === "string" ? source.model : choice.model;
              logOpenAITriageCacheUsage({
                tier,
                model: responseModel,
                usage,
                cacheKey,
              });
              return {
                decision: await verifyDecision(extractOpenAIToolInput(data), email),
                usage,
                provider: "openai",
                model: responseModel,
                tier,
                latency_ms: Date.now() - started,
              };
            }
            await res.text?.();
            throw Object.assign(new Error(`OpenAI triage API error (${res.status})`), { status: res.status, retryable: res.status === 429 || res.status >= 500 });
          }
          throw Object.assign(new Error(`OpenAI triage API error (${res.status})`), { status: res.status, retryable: res.status === 429 || res.status >= 500 });
        }
        const data = await res.json();
        const source = isRecord(data) ? data : {};
        const usage = isRecord(source.usage) ? source.usage as TriageModelUsage : {};
        const responseModel = typeof source.model === "string" ? source.model : choice.model;
        logOpenAITriageCacheUsage({
          tier,
          model: responseModel,
          usage,
          cacheKey,
        });
        return {
          decision: await verifyDecision(extractOpenAIToolInput(data), email),
          usage,
          provider: "openai",
          model: responseModel,
          tier,
          latency_ms: Date.now() - started,
        };
      }

      const apiKey = await credentialResolver("anthropic");
      if (!apiKey) {
        const err = new Error("ANTHROPIC_API_KEY not set for triage") as TriageError;
        err.status = 503;
        throw err;
      }
      const started = Date.now();
      const res = await fetchWithTimeout<TriageFetchResponse>("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: choice.model,
          max_tokens: 500,
          // Mark the stable prefix (tools render before system) as ephemeral
          // cacheable so repeated classifications in a tick reuse it instead of
          // re-billing the prompt + schema. Prompt caching is GA — no beta
          // header needed. Only the per-email user turn stays uncached.
          // NB: caching engages only when the system+tools prefix exceeds the
          // model's minimum cacheable size (2048 tok Sonnet, 4096 tok Haiku);
          // below that it is a harmless no-op (cache_read stays 0).
          system: [{
            type: "text",
            text: TRIAGE_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          }],
          tools: [{ ...TRIAGE_TOOL, cache_control: { type: "ephemeral" } }],
          tool_choice: { type: "tool", name: "submit_email_triage" },
          messages: [{
            role: "user",
            content: compactEmailForPrompt(email, reason),
          }],
        }),
      }, { timeoutMs: TRIAGE_MODEL_TIMEOUT_MS, fetchFn });
      if (!res.ok) {
        await res.text?.();
        throw Object.assign(new Error(`Anthropic triage API error (${res.status})`), { status: res.status, retryable: res.status === 429 || res.status >= 500 });
      }
      const data = await res.json();
      const source = isRecord(data) ? data : {};
      const usage = isRecord(source.usage) ? source.usage as TriageModelUsage : {};
      const responseModel = typeof source.model === "string" ? source.model : choice.model;
      logAnthropicTriageCacheUsage({
        tier,
        model: responseModel,
        usage,
      });
      return {
        decision: await verifyDecision(extractAnthropicToolInput(data), email),
        usage,
        provider: "anthropic",
        model: responseModel,
        tier,
        latency_ms: Date.now() - started,
      };
    },
  };
}
