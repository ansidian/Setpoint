import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTriageModelClient as createRuntimeTriageModelClient,
  loadTriageModelConfig,
} from "./triage-model-client.ts";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
} from "../bills/bill-extractors/catalog.ts";
import { BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS } from "../bills/bill-semantic-prompt.ts";

function createTriageModelClient(
  options: Parameters<typeof createRuntimeTriageModelClient>[0] = {},
) {
  return createRuntimeTriageModelClient({
    ...options,
    credentialResolver: async (provider) => process.env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"] || null,
  });
}

const email = {
  from_name: "University Billing",
  from_address: "billing@school.example",
  subject: "Tuition due",
  body_snippet: "Tuition is due May 8.",
  body_text: "Tuition balance $450.00 is due May 8.",
  email_date: "2026-05-03T12:00:00.000Z",
};

const decision = {
  lane: "needs_attention",
  category: "finance",
  urgency: "high",
  escalation_badge: "High Risk",
  summary: "Tuition payment is due soon.",
  action: "Review payment",
  deadline_at: "2026-05-08T16:00:00.000Z",
  confidence: 0.9,
  bill_candidate: null,
};

function anthropicResponse() {
  return {
    ok: true,
    json: async () => ({
      model: "claude-sonnet-4-6",
      content: [{ type: "tool_use", name: "submit_email_triage", input: decision }],
      usage: { input_tokens: 100, output_tokens: 40 },
    }),
  };
}

function openAIResponse(model: string) {
  return {
    ok: true,
    json: async () => ({
      model,
      output: [{
        type: "function_call",
        name: "submit_email_triage",
        arguments: JSON.stringify(decision),
      }],
      usage: { input_tokens: 90, output_tokens: 30 },
    }),
  };
}

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "EA_TRIAGE_CHEAP_MODEL",
  "EA_TRIAGE_STRONG_MODEL",
];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
});

describe("triage model client", () => {
  it("dispatches anthropic tiers with the triage tool and system prompt", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => anthropicResponse());
    const client = createTriageModelClient({ fetchImpl });

    const lateEvidence = `${"Earlier context. ".repeat(300)}\nYour request was cancelled. No further action is needed.`;
    const result = await client.classify({ tier: "strong", email: { ...email, body_text: lateEvidence }, reason: "hard_risk_override" });

    // test-architecture: allow-boundary-interaction -- Triage model fetch is an outbound AI-provider boundary; tier selection, retry payloads, and abort propagation are compatibility contracts.
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((options!.headers as Record<string, string>)["x-api-key"]).toBe("test-anthropic-key");
    const body = JSON.parse(String(options!.body));
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_email_triage" });
    // System is now an ephemeral-cacheable block array; the tool carries a
    // matching cache_control so the tools+system prefix is one cache breakpoint.
    expect(body.system[0].text).toContain(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS);
    expect(body.tools[0].input_schema.properties.bill_candidate.properties.amount_candidates.items.properties.kind.enum)
      .toContain("statement_balance");
    expect(body.tools[0].input_schema.properties.bill_candidate.properties.event_kind.enum)
      .toContain("payment_completed");
    expect(body.tools[0].input_schema.properties.bill_candidate.properties.account_last4.pattern)
      .toBe("^[0-9]{4}$");
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[0].content).toContain("Routing reason: hard_risk_override");
    expect(body.messages[0].content).toContain("Your request was cancelled. No further action is needed.");
    expect(result).toMatchObject({
      provider: "anthropic",
      tier: "strong",
      decision: { lane: "needs_attention", category: "finance" },
      usage: { input_tokens: 100, output_tokens: 40 },
    });
  });

  it("dispatches openai tiers with prompt caching and parses the function call", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => openAIResponse("gpt-5.4-nano"));
    const client = createTriageModelClient({
      fetchImpl,
      config: {
        cheap: { provider: "openai", model: "gpt-5.4-nano" },
        strong: { provider: "anthropic", model: "claude-sonnet-4-6" },
      },
    });

    const result = await client.classify({ tier: "cheap", email, reason: "no_preflight_match" });

    // test-architecture: allow-boundary-interaction -- Triage model fetch is an outbound AI-provider boundary; tier selection, retry payloads, and abort propagation are compatibility contracts.
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((options!.headers as Record<string, string>).Authorization).toBe("Bearer test-openai-key");
    const body = JSON.parse(String(options!.body));
    expect(body.model).toBe("gpt-5.4-nano");
    expect(body.prompt_cache_key).toBe("ea-email-triage:v11:cheap:gpt-5.4-nano");
    expect(body.tool_choice).toEqual({ type: "function", name: "submit_email_triage" });
    expect(body.tools[0].parameters.properties.bill_candidate.properties.amount_kind.enum)
      .toContain("minimum_due");
    expect(body.tools[0].parameters.properties.bill_candidate.properties.event_kind.enum)
      .toContain("purchase");
    expect(body.tools[0].parameters.properties.bill_candidate.properties.target_policy_key.type)
      .toContain("null");
    expect(body.tools[0].parameters.properties.bill_candidate.properties.account_last4_confidence.maximum)
      .toBe(1);
    expect(body.tools[0].parameters.properties.bill_candidate.properties.event_kind.type)
      .toContain("null");
    expect(body.tools[0].parameters.properties.bill_candidate.properties.from_account_hint.type)
      .toContain("null");
    expect(body.tools[0].parameters.properties.bill_candidate.required.sort())
      .toEqual(Object.keys(body.tools[0].parameters.properties.bill_candidate.properties).sort());
    expect(result).toMatchObject({
      provider: "openai",
      tier: "cheap",
      decision: { lane: "needs_attention" },
    });
  });

  it("returns a triage decision corrected by the shared multi-amount verifier", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const incompleteDecision = {
      ...decision,
      bill_candidate: {
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40 }],
      },
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        model: "gpt-5.4-mini",
        output: [{
          type: "function_call",
          name: "submit_email_triage",
          arguments: JSON.stringify(incompleteDecision),
        }],
        usage: { input_tokens: 90, output_tokens: 30 },
      }),
    }));
    const verifierProvider = {
      extract: vi.fn(async () => ({
        fields: {
          amount: 391.2,
          amount_kind: "statement_balance",
          amount_candidates: [
            { kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" },
            { kind: "other", value: 0, evidence: "Plan balance $0.00" },
            { kind: "statement_balance", value: 391.2, evidence: "Remaining statement balance $391.20" },
          ],
        },
        usage: {},
      })),
    };
    const client = createTriageModelClient({
      fetchImpl,
      billExtractionProviders: { openai: verifierProvider as never },
      config: {
        cheap: { provider: "openai", model: "gpt-5.4-mini" },
        strong: { provider: "openai", model: "gpt-5.4" },
      },
    });

    const result = await client.classify({
      tier: "cheap",
      email: {
        ...email,
        body_text: "Minimum payment $40.00. Plan balance $0.00. Remaining statement balance $391.20.",
      },
      reason: "finance",
    });

    const resultDecision = result.decision as Record<string, unknown>;
    expect(resultDecision.bill_candidate).toMatchObject({
      amount: 391.2,
      amount_kind: "statement_balance",
      amount_verification: { status: "corrected" },
    });
  });

  it("selects the model for the requested tier", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => anthropicResponse());
    const client = createTriageModelClient({
      fetchImpl,
      config: {
        cheap: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
        strong: { provider: "anthropic", model: "claude-sonnet-4-6" },
      },
    });

    await client.classify({ tier: "cheap", email, reason: "" });
    await client.classify({ tier: "strong", email, reason: "" });

    // test-architecture: allow-boundary-interaction -- Triage model fetch is an outbound AI-provider boundary; tier selection, retry payloads, and abort propagation are compatibility contracts.
    const models = fetchImpl.mock.calls.map(([, options]) => JSON.parse(String(options!.body)).model);
    expect(models).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]);
  });

  it("fails with a 503 when the provider API key is missing", async () => {
    const fetchImpl = vi.fn();
    const client = createTriageModelClient({ fetchImpl });

    await expect(client.classify({ tier: "cheap", email, reason: "" }))
      .rejects.toMatchObject({ status: 503 });
    // test-architecture: allow-boundary-interaction -- Model fetch is the outbound AI-provider boundary; missing credentials must fail before any email content leaves the process.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the anthropic classify request with an AbortSignal", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => anthropicResponse());
    const client = createTriageModelClient({ fetchImpl });

    await client.classify({ tier: "strong", email, reason: "hard_risk_override" });

    // test-architecture: allow-boundary-interaction -- Triage model fetch is an outbound AI-provider boundary; tier selection, retry payloads, and abort propagation are compatibility contracts.
    expect(fetchImpl.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the openai classify request with an AbortSignal", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => openAIResponse("gpt-5.4-nano"));
    const client = createTriageModelClient({
      fetchImpl,
      config: {
        cheap: { provider: "openai", model: "gpt-5.4-nano" },
        strong: { provider: "anthropic", model: "claude-sonnet-4-6" },
      },
    });

    await client.classify({ tier: "cheap", email, reason: "no_preflight_match" });

    // test-architecture: allow-boundary-interaction -- Triage model fetch is an outbound AI-provider boundary; tier selection, retry payloads, and abort propagation are compatibility contracts.
    expect(fetchImpl.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the openai cache-fields retry request with an AbortSignal", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _options?: RequestInit): Promise<Record<string, unknown>> => openAIResponse("gpt-5.4-nano"))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "prompt_cache_key is not supported",
      })
      .mockResolvedValueOnce(openAIResponse("gpt-5.4-nano"));
    const client = createTriageModelClient({
      fetchImpl,
      config: {
        cheap: { provider: "openai", model: "gpt-5.4-nano" },
        strong: { provider: "anthropic", model: "claude-sonnet-4-6" },
      },
    });

    await client.classify({ tier: "cheap", email, reason: "no_preflight_match" });

    // test-architecture: allow-boundary-interaction -- OpenAI fetch is outbound; an unsupported cache-field response permits exactly one compatibility retry without those fields.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // test-architecture: allow-boundary-interaction -- Triage model fetch is an outbound AI-provider boundary; tier selection, retry payloads, and abort propagation are compatibility contracts.
    const firstBody = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    // test-architecture: allow-boundary-interaction -- Triage model fetch is an outbound AI-provider boundary; tier selection, retry payloads, and abort propagation are compatibility contracts.
    const retryBody = JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body));
    expect(firstBody.prompt_cache_key).toBe("ea-email-triage:v11:cheap:gpt-5.4-nano");
    expect(firstBody.prompt_cache_retention).toBe("24h");
    expect(retryBody.store).toBe(false);
    expect(retryBody.prompt_cache_key).toBeUndefined();
    expect(retryBody.prompt_cache_retention).toBeUndefined();
    // test-architecture: allow-boundary-interaction -- Triage model fetch is an outbound AI-provider boundary; tier selection, retry payloads, and abort propagation are compatibility contracts.
    expect(fetchImpl.mock.calls[1]![1]!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("loadTriageModelConfig", () => {
  it("builds the cheap tier from bill-extract settings and the strong tier from email AI settings", async () => {
    const dbClient = {
      execute: vi.fn(async () => ({
        rows: [{
          email_ai_provider: "openai",
          email_ai_model: "gpt-5.4",
          bill_extract_provider: "anthropic",
          bill_extract_model: "claude-haiku-4-5",
        }],
      })),
    };

    const config = await loadTriageModelConfig("user-1", dbClient);

    expect(config).toEqual({
      cheap: { provider: "anthropic", model: "claude-haiku-4-5" },
      strong: { provider: "openai", model: "gpt-5.4" },
    });
  });

  it("falls back to catalog defaults when settings are unreadable", async () => {
    const dbClient = {
      execute: vi.fn(async () => {
        throw new Error("no settings table");
      }),
    };

    const config = await loadTriageModelConfig("user-1", dbClient);

    expect(config.cheap).toEqual({
      provider: DEFAULT_BILL_EXTRACT_PROVIDER,
      model: DEFAULT_BILL_EXTRACT_MODEL,
    });
    expect(config.strong).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("lets EA_TRIAGE_* env overrides win and infers their provider", async () => {
    process.env.EA_TRIAGE_STRONG_MODEL = "gpt-5.4";
    const dbClient = { execute: vi.fn(async () => ({ rows: [] })) };

    const config = await loadTriageModelConfig("user-1", dbClient);

    expect(config.strong).toEqual({ provider: "openai", model: "gpt-5.4" });
  });
});
