import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { InStatement } from "@libsql/client";
import db from "../db/connection.ts";
import type { AiUsageOrigin, AiUsagePurpose, AiUsageRunContext } from "../../shared/types/ai-usage.ts";
import { estimateAiUsageCost, normalizeAiUsage, type AiUsageTokens } from "./ai-usage-tokens.ts";
import { withTimeout } from "./fetch-with-timeout.ts";

export interface AiUsageDb {
  execute(statement: InStatement): Promise<{ rows: Record<string, unknown>[] }>;
}
interface AiUsageContext {
  userId: string;
  origin: AiUsageOrigin;
  runContext?: AiUsageRunContext;
  runId?: string;
  accountId?: string | null;
  emailId?: string | null;
  dbClient?: AiUsageDb;
}
type ActiveContext = AiUsageContext & { runId: string; runContext: AiUsageRunContext };
const runScope = new AsyncLocalStorage<ActiveContext>();

// Explicit root boundaries set attribution. Nested helpers preserve that root;
// evaluation can only tighten the context and cannot turn back into production.
export function withAiUsageContext<T>(context: AiUsageContext, work: () => T): T {
  const parent = runScope.getStore();
  const inherited = !context.userId || parent?.userId === context.userId ? parent : undefined;
  return runScope.run({
    ...context, ...inherited,
    accountId: context.accountId ?? inherited?.accountId,
    emailId: context.emailId ?? inherited?.emailId,
    runId: inherited?.runId ?? context.runId ?? randomUUID(),
    runContext: inherited?.runContext === "evaluation" || context.runContext === "evaluation"
      ? "evaluation" : "production",
  }, work);
}

export interface AiUsageEvent extends AiUsageTokens {
  eventId: string;
  userId: string;
  runId: string;
  runContext: AiUsageRunContext;
  origin: AiUsageOrigin;
  accountId?: string | null;
  emailId?: string | null;
  provider: "openai" | "anthropic";
  model: string;
  purpose: AiUsagePurpose;
  startedAt: string;
  finishedAt: string;
  providerLatencyMs: number;
  outcome: "response_received" | "succeeded" | "provider_error" | "parse_error";
  httpStatus: number | null;
  estimatedCostUsd: number | null;
  pricingVersion: string | null;
}

// One event ID is one actual attempt. The only legal rewrite finishes a received
// response; retries of a terminal event cannot regress or inflate the ledger.
export async function recordAiUsageEvent(event: AiUsageEvent, { dbClient = db }: { dbClient?: AiUsageDb } = {}): Promise<void> {
  await dbClient.execute({
    sql: `INSERT INTO ea_ai_usage_events
      (event_id, user_id, run_id, run_context, origin, account_id, email_id, provider, model, purpose,
       started_at, finished_at, provider_latency_ms, outcome, http_status, input_tokens, output_tokens,
       cached_input_tokens, cache_creation_input_tokens, cache_creation_5m_tokens, cache_creation_1h_tokens,
       estimated_cost_usd, pricing_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET outcome = excluded.outcome
      WHERE ea_ai_usage_events.user_id = excluded.user_id
        AND ea_ai_usage_events.outcome = 'response_received'
        AND excluded.outcome IN ('succeeded', 'parse_error', 'provider_error')`,
    args: [event.eventId, event.userId, event.runId, event.runContext, event.origin,
      event.accountId ?? null, event.emailId ?? null, event.provider, event.model, event.purpose,
      event.startedAt, event.finishedAt, event.providerLatencyMs, event.outcome, event.httpStatus,
      event.inputTokens, event.outputTokens, event.cachedInputTokens, event.cacheCreationInputTokens,
      event.cacheCreation5mTokens, event.cacheCreation1hTokens, event.estimatedCostUsd, event.pricingVersion],
  });
}

interface UsageCall {
  capture(response: unknown): Promise<void>;
  setHttpStatus(status: number): void;
}

export async function trackedAiProviderCall<T>(
  options: { provider: "openai" | "anthropic"; model: string; purpose: AiUsagePurpose },
  work: (call: UsageCall) => Promise<T>,
): Promise<T> {
  const context = runScope.getStore();
  // Evaluation tags exclude test spend without preparing or writing events.
  // Never send a unit test's fabricated provider usage to the developer's DB.
  // Ledger integration tests explicitly supply an ephemeral database and run
  // this same production path in full.
  if (context?.runContext === "evaluation" || (process.env.VITEST && !context?.dbClient)) {
    return work({ capture: async () => {}, setHttpStatus: () => {} });
  }
  const started = performance.now();
  const startedAt = new Date().toISOString();
  let received = false;
  let event: AiUsageEvent | undefined;
  let httpStatus: number | null = null;
  const eventId = randomUUID();
  const save = async () => {
    if (!event) return;
    try {
      await withTimeout(recordAiUsageEvent(event, { dbClient: context?.dbClient }), 1500, "AI usage recording");
    } catch {
      // No raw DB/provider error: it can contain connection credentials or text.
      console.warn(`[AI usage] recording failed event=${eventId}`);
    }
  };
  const capture = async (response: unknown) => {
    if (received) return;
    received = true;
    const source = response !== null && typeof response === "object" ? response as Record<string, unknown> : {};
    const model = typeof source.model === "string" ? source.model : options.model;
    const tokens = normalizeAiUsage(options.provider, source.usage);
    if (!context?.userId) {
      console.warn(`[AI usage] missing run attribution event=${eventId}`);
      return;
    }
    event = {
      ...context, ...options, model, ...tokens,
      ...estimateAiUsageCost(options.provider, model, tokens, source.service_tier),
      eventId, startedAt, finishedAt: new Date().toISOString(),
      providerLatencyMs: Math.max(0, performance.now() - started),
      outcome: "response_received", httpStatus,
    };
    await save();
  };
  try {
    const result = await work({ capture, setHttpStatus: (status) => { httpStatus = status; } });
    if (!received) await capture(null);
    if (event) event.outcome = "succeeded";
    await save();
    return result;
  } catch (error) {
    const hadResponse = received;
    if (!received) await capture(null);
    if (event) event.outcome = hadResponse ? "parse_error" : "provider_error";
    await save();
    throw error;
  }
}
