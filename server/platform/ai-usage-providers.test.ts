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
import { createOpenAiProvider } from "../bills/bill-extractors/openai.ts";
import { createAnthropicProvider } from "../bills/bill-extractors/anthropic.ts";
import { createBillCandidateVerificationService } from "../bills/bill-candidate-verification-service.ts";
import { resolveFinancialEmailSeed } from "../bills/financial-email-adoption-service.ts";

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
  escalation_badge: null, bill_candidate: null,
};
const model = "gpt-5.4-mini";
const config = {
  cheap: { provider: "openai", model },
  strong: { provider: "openai", model: "gpt-5.4" },
};

function scoped<T>(work: () => T) {
  return withAiUsageContext({ userId, origin: "manual_extraction", dbClient }, work);
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

function billResponse(fields: Record<string, unknown> = {}) {
  return response({ model, output_text: JSON.stringify(fields), usage: { input_tokens: 80, output_tokens: 10 } });
}

async function events() {
  return (await dbClient.execute("SELECT * FROM ea_ai_usage_events ORDER BY rowid")).rows;
}

async function migrate(filename: string) {
  await dbClient.executeMultiple(await readFile(new URL(`../db/migrations/${filename}`, import.meta.url), "utf8"));
}

beforeEach(async () => {
  dbClient = createClient({ url: ":memory:" });
  for (const filename of ["001_ea_tables.sql", "057_email_ai_usage.sql"]) {
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

  it.each(["openai", "anthropic"] as const)("preserves %s envelope usage when extraction parsing fails", async (providerId) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => response(providerId === "openai"
      ? { model, output_text: "invalid-json", usage: { input_tokens: 80, output_tokens: 10 } }
      : { model: "claude-haiku-4-5", content: [], usage: { input_tokens: 80, output_tokens: 10, cache_read_input_tokens: 25, cache_creation_input_tokens: 5 } }));
    const provider = providerId === "openai" ? createOpenAiProvider({ resolveApiKey }) : createAnthropicProvider({ resolveApiKey });
    await expect(scoped(() => provider.extract({ model, systemPrompt: "test", content: "test" }))).rejects.toThrow("Extraction failed");
    expect(await events()).toMatchObject([{
      provider: providerId, purpose: "extraction", outcome: "parse_error", output_tokens: 10,
      input_tokens: providerId === "openai" ? 80 : 110,
      cached_input_tokens: providerId === "openai" ? 0 : 25,
    }]);
  });

  it("counts amount/event audits and a rejected matching result independently", async () => {
    vi.stubGlobal("fetch", async (_input: unknown, options?: RequestInit) => {
      const prompt = JSON.parse(String(options?.body)).instructions as string;
      if (prompt.startsWith("Choose")) return billResponse({ target_policy_key: "invented", target_confidence: 0.99, target_evidence: "purchase" });
      return billResponse({
        amount: 20, amount_kind: "order_total", amount_candidates: [{ kind: "minimum_due", value: 10, evidence: "Minimum payment $10" }, { kind: "order_total", value: 20, evidence: "Your purchase total $20" }],
        event_kind: "purchase", event_confidence: 0.99, event_evidence: "purchase",
        type: "expense", type_confidence: 0.99, type_evidence: "purchase",
      });
    });
    const service = createBillCandidateVerificationService({ credentialResolver: resolveApiKey });
    await scoped(async () => {
      const verified = await service.verifyEmailCandidate({
        email: { body: "Your purchase total $20. Minimum payment $10." },
        candidate: { amount: 10, amount_kind: "payment_amount", event_kind: "other" },
        providerId: "openai", model,
      });
      expect(verified).toMatchObject({ amount: 20, event_kind: "purchase" });
      const ranking = await service.rankEmailTargetBundles({
        email: { body: "Your purchase total $20." }, candidate: verified,
        options: [{ key: "option_1", description: "Household" }], providerId: "openai", model,
      });
      expect(ranking.status).toBe("unresolved");
    });
    const rows = await events();
    expect(rows.map((row) => row.purpose)).toEqual(["verification", "verification", "matching"]);
    expect(rows.every((row) => row.outcome === "succeeded" && row.input_tokens === 80)).toBe(true);
  });

  it("does not count deterministic repairs or unavailable credentials as provider calls", async () => {
    const service = createBillCandidateVerificationService({ credentialResolver: async () => null });
    const candidate = await scoped(() => service.verifyEmailCandidate({
      email: { body: "Minimum payment $40.00. Statement balance $391.20." },
      candidate: {
        amount: 40, amount_kind: "payment_amount", amount_candidates: [{ kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" }, { kind: "statement_balance", value: 391.2, evidence: "Statement balance $391.20" }],
        event_kind: "statement_issued", event_confidence: 0.99,
        type: "transfer", type_confidence: 0.99, type_evidence: "Statement balance",
      }, providerId: "openai", model,
    }));
    expect(candidate).toMatchObject({ amount: 391.2, amount_verification: { status: "corrected" } });
    const provider = createOpenAiProvider({ resolveApiKey: async () => null });
    await expect(scoped(() => provider.extract({ model, systemPrompt: "test", content: "test" }))).rejects.toThrow("OPENAI_API_KEY not set");
    expect(await events()).toEqual([]);
  });

  it("persists concurrent attempts independently even when their candidate content is identical", async () => {
    vi.stubGlobal("fetch", async () => billResponse({ payee: "Household", amount: 20 }));
    const provider = createOpenAiProvider({ resolveApiKey });
    const run = () => scoped(() => provider.extract({ model, systemPrompt: "same", content: "same" }));
    await Promise.all([run(), run()]);
    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(2);
    expect(new Set(rows.map((row) => row.run_id)).size).toBe(2);
  });

  it("retains a transport failure swallowed by matching", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    const service = createBillCandidateVerificationService({ credentialResolver: resolveApiKey });
    const result = await scoped(() => service.rankEmailTargetBundles({
      email: { body: "Purchase" }, candidate: { event_kind: "purchase" },
      options: [{ key: "option_1", description: "Household" }], providerId: "openai", model,
    }));
    expect(result.status).toBe("failed");
    expect(await events()).toMatchObject([{ purpose: "matching", outcome: "provider_error", input_tokens: null, http_status: null }]);
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

  it("reuses a stored financial plan without creating a provider event", async () => {
    await migrate("052_financial_email_plans.sql");
    await migrate("054_email_sender_authentication.sql");
    const candidate = {
      amount: 20, type: "expense", type_confidence: 0.99, type_evidence: "purchase",
      event_kind: "purchase", event_confidence: 0.99,
    };
    const plan = {
      version: 1, identity: { version: 1, status: "resolved", key: "financial-email:test" },
      candidate, classification: { documentKind: "one_time_transaction" },
      operation: { intended: "create_transaction", kind: "review" }, targets: {},
      reconciliation: { status: "not_checked", disposition: "review" },
      automation: { eligible: false, operationClass: "one_time_expense", gates: [] },
    };
    await dbClient.execute({
      sql: "INSERT INTO ea_email_triage (user_id, account_id, email_id, bill_candidate_json, financial_email_plan_json) VALUES (?, ?, ?, ?, ?)",
      args: [userId, email.account_id, email.email_id, JSON.stringify(candidate), JSON.stringify(plan)],
    });
    const result = await scoped(() => resolveFinancialEmailSeed(userId, {
      accountId: email.account_id, emailId: email.email_id, dbClient,
    }));
    expect(result).toEqual(plan);
    expect(await events()).toEqual([]);
  });
});
