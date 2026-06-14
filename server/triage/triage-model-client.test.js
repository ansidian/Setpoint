import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTriageModelClient,
  loadTriageModelConfig,
} from "./triage-model-client.js";
import {
  DEFAULT_BILL_EXTRACT_PROVIDER,
  DEFAULT_BILL_EXTRACT_MODEL,
} from "../bills/bill-extractors/catalog.js";

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

function openAIResponse(model) {
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
let savedEnv;

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
    const fetchImpl = vi.fn(async () => anthropicResponse());
    const client = createTriageModelClient({ fetchImpl });

    const result = await client.classify({ tier: "strong", email, reason: "hard_risk_override" });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.headers["x-api-key"]).toBe("test-anthropic-key");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_email_triage" });
    expect(body.system).toContain("Classify one email");
    expect(body.messages[0].content).toContain("Routing reason: hard_risk_override");
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
    const fetchImpl = vi.fn(async () => openAIResponse("gpt-5.4-nano"));
    const client = createTriageModelClient({
      fetchImpl,
      config: {
        cheap: { provider: "openai", model: "gpt-5.4-nano" },
        strong: { provider: "anthropic", model: "claude-sonnet-4-6" },
      },
    });

    const result = await client.classify({ tier: "cheap", email, reason: "no_preflight_match" });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options.headers.Authorization).toBe("Bearer test-openai-key");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("gpt-5.4-nano");
    expect(body.prompt_cache_key).toBe("ea-email-triage:v1:cheap:gpt-5.4-nano");
    expect(body.tool_choice).toEqual({ type: "function", name: "submit_email_triage" });
    expect(result).toMatchObject({
      provider: "openai",
      tier: "cheap",
      decision: { lane: "needs_attention" },
    });
  });

  it("selects the model for the requested tier", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    const fetchImpl = vi.fn(async () => anthropicResponse());
    const client = createTriageModelClient({
      fetchImpl,
      config: {
        cheap: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
        strong: { provider: "anthropic", model: "claude-sonnet-4-6" },
      },
    });

    await client.classify({ tier: "cheap", email, reason: "" });
    await client.classify({ tier: "strong", email, reason: "" });

    const models = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body).model);
    expect(models).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]);
  });

  it("fails with a 503 when the provider API key is missing", async () => {
    const fetchImpl = vi.fn();
    const client = createTriageModelClient({ fetchImpl });

    await expect(client.classify({ tier: "cheap", email, reason: "" }))
      .rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
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
