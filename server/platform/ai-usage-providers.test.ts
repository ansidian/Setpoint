import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withAiUsageContext } from "./ai-usage.ts";
import { createTriageModelClient } from "../triage/triage-model-client.ts";
import { routeEmailForTriage } from "../triage/triage-worker.ts";
import { runTriageEval } from "../triage/triage-eval.ts";
import runtimeDb from "../db/connection.ts";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";

// This integration seam owns the consequential contract: actual provider
// attempts survive as durable ledger rows, regardless of downstream decisions.
let dbClient: Client;
const userId = "usage-test";
const resolveApiKey = async () => "test-key";
const email = {
  user_id: userId, account_id: "account-test", email_id: "email-test",
  from_address: "person@example.test", subject: "Can we meet?",
  body_text: "Could we meet next week to discuss the project?",
};
const decision = {
  lane: "fyi", category: "personal", urgency: "normal", confidence: 0.95,
  summary: "Meeting request", action: "Read", deadline_at: null,
  escalation_badge: null,
};
const model = "gpt-5.4-mini";
const config = {
  cheap: { provider: "openai", model },
  strong: { provider: "openai", model: "gpt-5.4" },
};

function scoped<T>(work: () => T) {
  return withAiUsageContext({ userId, origin: "background_triage", dbClient }, work);
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function triageResponse(value = decision, responseModel = model) {
  return response({
    model: responseModel,
    usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } },
    output: [{ type: "function_call", name: "submit_email_triage", arguments: JSON.stringify(value) }],
  });
}

async function events() {
  return (await dbClient.execute("SELECT * FROM ea_ai_usage_events ORDER BY rowid")).rows;
}

async function migrate(filename: string) {
  await dbClient.executeMultiple(await readFile(new URL(`../db/migrations/${filename}`, import.meta.url), "utf8"));
}

beforeEach(async () => {
  dbClient = createClient({ url: ":memory:" });
  for (const filename of ["001_ea_tables.sql", "057_email_ai_usage.sql", "072_ai_usage_diagnostics.sql"]) {
    await migrate(filename);
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  dbClient.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("provider attempts to durable AI accounting", () => {
  it.each(["openai", "anthropic"] as const)("retains %s strong-pass truncation diagnostics from the actual provider adapter", async (provider) => {
    const budget = provider === "openai" ? 1600 : 1400;
    const fetchImpl = async (_input: unknown, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body));
      // Model the external provider returning a response truncated at the requested limit.
      const limit = request.max_output_tokens ?? request.max_tokens;
      return response(provider === "openai"
        ? { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 100, output_tokens: limit, output_tokens_details: { reasoning_tokens: 1200 } }, output: [{ type: "function_call", name: "submit_email_triage", arguments: '{"private email text":' }] }
        : { stop_reason: "max_tokens", usage: { input_tokens: 100, output_tokens: limit }, content: [{ type: "text", text: "private email text" }] });
    };
    const client = createTriageModelClient({ fetchImpl, config: { cheap: { provider, model }, strong: { provider, model } }, credentialResolver: resolveApiKey });
    await expect(scoped(() => client.classify({ tier: "strong", email, reason: "test" }))).rejects.toThrow();
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "triage_strong", outcome: "parse_error", http_status: 200, output_tokens: budget });
    expect(JSON.parse(String(rows[0]!.diagnostics_json))).toEqual({
      responseStatus: provider === "openai" ? "incomplete" : null,
      stopReason: provider === "openai" ? "max_output_tokens" : "max_tokens",
      maxOutputTokens: budget, reasoningTokens: provider === "openai" ? 1200 : null, failureCode: "output_limit",
    });
    expect(JSON.stringify(rows)).not.toContain("private email text");
  });

  it("retains a rejected cache-fields attempt separately from its successful retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = async (_input: unknown, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      return body.prompt_cache_key
        ? response({ error: { message: "prompt_cache_retention unsupported" } }, 400)
        : triageResponse();
    };
    const client = createTriageModelClient({ fetchImpl, config, credentialResolver: resolveApiKey });
    const result = await scoped(() => client.classify({ tier: "cheap", email, reason: "test" }));
    expect(result.decision).toMatchObject({ lane: "fyi" });
    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ purpose: "triage_cheap", outcome: "provider_error", http_status: 400, input_tokens: null });
    expect(rows[1]).toMatchObject({ purpose: "triage_cheap", outcome: "succeeded", http_status: 200, input_tokens: 100, cached_input_tokens: 40 });
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(2);
    expect(new Set(rows.map((row) => row.run_id)).size).toBe(1);
  });

  it("records both production tiers on escalation through routing", async () => {
    const fetchImpl = async (_input: unknown, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body));
      return triageResponse({ ...decision, confidence: request.model === model ? 0.2 : 0.95 }, request.model);
    };
    const client = createTriageModelClient({ fetchImpl, config, credentialResolver: resolveApiKey });
    const routed = await withAiUsageContext({
      userId, origin: "background_triage", dbClient,
    }, () => routeEmailForTriage(email, { dbClient, modelClient: client }));
    expect(routed.decision.confidence).toBe(0.95);
    const rows = await events();
    expect(rows.map((row) => row.purpose)).toEqual(["triage_cheap", "triage_strong"]);
    expect(rows.every((row) => row.run_context === "production" && row.origin === "background_triage")).toBe(true);
  });

  it("persists concurrent attempts independently even when their email content is identical", async () => {
    const client = createTriageModelClient({ fetchImpl: async () => triageResponse(), config, credentialResolver: resolveApiKey });
    const run = () => scoped(() => client.classify({ tier: "cheap", email, reason: "same" }));
    await Promise.all([run(), run()]);
    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(2);
    expect(new Set(rows.map((row) => row.run_id)).size).toBe(2);
  });

  it("does not persist real-model evaluation calls and restores production accounting afterward", async () => {
    await migrate("033_instance_credentials.sql");
    await migrate("040_pending_credential_lifecycle.sql");
    // Redirect the process DB boundary, including runtime credential reads, to
    // the disposable DB; all real services and provider adapters still execute.
    vi.spyOn(runtimeDb, "execute").mockImplementation((statement) => dbClient.execute(statement));
    vi.stubEnv("EA_TRIAGE_EVAL_REAL_MODELS", "1");
    vi.stubEnv("EA_USER_ID", userId);
    vi.stubEnv("EA_TRIAGE_CHEAP_MODEL", model);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", async () => triageResponse());
    const directory = await createTestTempDir("ai-usage-eval-");
    try {
      const fixturePath = join(directory, "fixture.json");
      await writeFile(fixturePath, JSON.stringify([{
        ...email, user_id: "fixture-label-not-owner", labels_verified: true, expected_lane: "fyi", expected_category: "personal",
      }]));
      await scoped(async () => {
        const report = await runTriageEval({ fixturePath, useRealModels: true, dbClient });
        expect(report.labeled_examples).toBe(1);
        expect(await events()).toEqual([]);
        await createTriageModelClient({ config, credentialResolver: resolveApiKey })
          .classify({ tier: "cheap", email, reason: "production after evaluation" });
      });
      const rows = await events();
      expect(rows.map((row) => row.run_context)).toEqual(["production"]);
      expect(rows.every((row) => row.user_id === userId)).toBe(true);
    } finally {
      await removeTempDir(directory);
    }
  });
});
