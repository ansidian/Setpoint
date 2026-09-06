import db from "../db/connection.ts";
import { requireCompleteEmailEvidence } from "../email/email-evidence.ts";
import { resolveEmailAiModelConfig, inferEmailAiProviderFromModel } from "../email/email-ai-models.ts";
import {
  DEFAULT_BILL_EXTRACT_MODEL,
  resolveBillExtractModelConfig,
} from "../bills/bill-extractors/catalog.ts";
import { createBillCandidateVerificationService, validateFinancialSemanticIdentity } from "../bills/bill-candidate-verification-service.ts";
import { BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS, BILL_SEMANTIC_IDENTITY_PROPERTIES, BILL_SEMANTIC_IDENTITY_REQUIRED } from "../bills/bill-semantic-prompt.ts";
import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import { trackedAiProviderCall, withAiUsageContext } from "../platform/ai-usage.ts";
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
const TRIAGE_PROMPT_CACHE_VERSION = "v11";
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
          ...BILL_SEMANTIC_IDENTITY_PROPERTIES,
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
          event_kind: { type: ["string", "null"], enum: [...BILL_EVENT_KINDS, null] },
          event_confidence: { type: ["number", "null"] },
          event_evidence: { type: ["string", "null"] },
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
        required: [
          ...BILL_SEMANTIC_IDENTITY_REQUIRED,
          "payee_hint",
          "amount",
          "amount_kind",
          "amount_candidates",
          "event_kind",
          "event_confidence",
          "event_evidence",
          "account_last4",
          "account_last4_evidence",
          "account_last4_confidence",
          "target_policy_key",
          "target_confidence",
          "target_evidence",
          "due_date",
          "currency",
          "requires_confirmation",
        ],
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
- Decide whether the email describes an actual financial event for the recipient before extracting a bill_candidate. Admit real purchases/charges, issued bills or invoices, credit-card repayment obligations, scheduled/completed/cancelled/failed payments, received income, refunds, and earned rewards. Category=finance, a dollar amount, or financial vocabulary alone never establishes a candidate.
- Return bill_candidate=null for advertisements, prices or quotes without a purchase, coupons, potential savings or reward offers, financial news/advice, credit-score monitoring, balance-only alerts, payment-method updates, and shipping/return/drop-off notices that establish no new financial event. A request to update an expired card or top up a low balance can require attention without being a transaction or bill.
- Keep a real financial event as a candidate when its amount, operation date, payee, or Actual targets are missing; missing details do not make a real event nonfinancial. Conversely, do not invent an event or return an empty candidate just because the email discusses money.
- A refund request received or under review is not an issued refund. Return bill_candidate=null for pending refund/return requests, even when they repeat the original purchase and requested refund amount. Keep refunds explicitly approved for payment, issued, on their way, or credited; do not claim settlement before it happens.
- Timesheet approval or acceptance for payroll processing alone is administrative, not an income payment. Return bill_candidate=null until the email confirms an actual payment instruction, disbursement, or received income. Likewise, an estimated subscription price contingent on adding payment details is not a bill or scheduled payment unless an existing amount owed or unconditional charge is established. These notices can still need attention. Do not use event_kind=other to turn administrative updates into candidates.
- Return bill_candidate=null for statement-availability notices unless the email explicitly identifies a credit-card/loan repayment statement, an issued bill, or a specific transaction. A bank name and generic statement wording alone do not establish an obligation. Keep explicitly identified credit-card statements even without an amount or due date.
- A document-availability notice that explicitly lists a bill or invoice among the available documents is a bill_issued candidate. For example, an insurance document bundle listing a Renewal Bill establishes an issued bill, even alongside policy declarations, ID cards, or privacy notices. Return type=bill and event_kind=bill_issued with verbatim bill-title evidence; leave unavailable amount/date null. Do not discard it as generic policy-document availability or require opening the linked bill first.
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
    requireCompleteEmailEvidence(email.body_text || ""),
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
    max_output_tokens: 1600,
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
    candidate: validateFinancialSemanticIdentity(decision.bill_candidate as BillCandidate, compactEmailForPrompt(email, "")),
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
    tier: TriageModelTier,
  ) => {
    const choice = config[tier];
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
      return withAiUsageContext({
        userId: String(email.user_id || ""), origin: "background_triage",
        accountId: typeof email.account_id === "string" ? email.account_id : null,
        emailId: typeof email.email_id === "string" ? email.email_id : null,
      }, async () => {
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
          };
          const attempt = (includeCacheFields: boolean) => trackedAiProviderCall({
            provider: "openai", model: choice.model, purpose: tier === "cheap" ? "triage_cheap" : "triage_strong",
          }, async (call) => {
            const res = await fetchWithTimeout<TriageFetchResponse>("https://api.openai.com/v1/responses", {
                ...requestOptions,
                body: JSON.stringify(buildOpenAITriageRequestBody({
                  model: choice.model,
                  email,
                  reason,
                  cacheKey,
                  includeCacheFields,
                })),
              }, { timeoutMs: TRIAGE_MODEL_TIMEOUT_MS, fetchFn });
            call.setHttpStatus(res.status);
            if (!res.ok) {
              const text = await res.text?.();
              throw Object.assign(new Error(`OpenAI triage API error (${res.status})`), {
                status: res.status,
                retryable: res.status === 429 || res.status >= 500,
                cacheFieldsRejected: includeCacheFields && isOpenAICacheParameterError(res.status, text),
              });
            }
            const data = await res.json();
            await call.capture(data);
            const source = isRecord(data) ? data : {};
            return {
              decision: extractOpenAIToolInput(data),
              usage: isRecord(source.usage) ? source.usage as TriageModelUsage : {},
              responseModel: typeof source.model === "string" ? source.model : choice.model,
            };
          });
          let result: Awaited<ReturnType<typeof attempt>>;
          try {
            result = await attempt(true);
          } catch (error) {
            if (!isRecord(error) || !error.cacheFieldsRejected) throw error;
            console.warn(
              `[Email Triage] OpenAI cache fields rejected for tier=${tier} model=${choice.model}; `
              + "retrying without cache-only fields",
            );
            result = await attempt(false);
          }
          const { decision, usage, responseModel } = result;
          logOpenAITriageCacheUsage({
            tier,
            model: responseModel,
            usage,
            cacheKey,
          });
          return {
            decision: await verifyDecision(decision, email, tier),
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
        const { decision, usage, responseModel } = await trackedAiProviderCall({
          provider: "anthropic", model: choice.model, purpose: tier === "cheap" ? "triage_cheap" : "triage_strong",
        }, async (call) => {
          const res = await fetchWithTimeout<TriageFetchResponse>("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: choice.model,
              max_tokens: 1400,
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
          call.setHttpStatus(res.status);
          if (!res.ok) {
            await res.text?.();
            throw Object.assign(new Error(`Anthropic triage API error (${res.status})`), { status: res.status, retryable: res.status === 429 || res.status >= 500 });
          }
          const data = await res.json();
          await call.capture(data);
          const source = isRecord(data) ? data : {};
          const usage = isRecord(source.usage) ? source.usage as TriageModelUsage : {};
          const responseModel = typeof source.model === "string" ? source.model : choice.model;
          return { decision: extractAnthropicToolInput(data), usage, responseModel };
        });
        logAnthropicTriageCacheUsage({
          tier,
          model: responseModel,
          usage,
        });
        return {
          decision: await verifyDecision(decision, email, tier),
          usage,
          provider: "anthropic",
          model: responseModel,
          tier,
          latency_ms: Date.now() - started,
        };
      });
    },
  };
}
