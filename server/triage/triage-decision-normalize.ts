import { preflightDecisionMetadata } from "./triage-preflight.ts";
import type {
  TriageDecision,
  TriageDecisionOverrides,
  TriageEmail,
  TriageModelResult,
  TriageModelTier,
  TriagePreflightResult,
  TriageUrgency,
  TriageLane,
} from "./triage-types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Every triage decision — model, fallback, no-model, preflight — must flow
// through createTriageDecision so updateTriageRow always sees one shape.
export function createTriageDecision(overrides: TriageDecisionOverrides = {}): TriageDecision {
  return {
    lane: "needs_attention",
    category: "uncategorized",
    urgency: "normal",
    escalation_badge: null,
    summary: "",
    action: "",
    deadline_at: null,
    confidence: null,
    triage_source: "unknown",
    rule_id: null,
    model_usage: {},
    // DEAD COLUMN (P3-69): no producer ever computes a real per-email cost, so this
    // stays permanently null. Kept here only so updateTriageRow's UPDATE binds a valid
    // SQL NULL (libsql rejects undefined bind args) and so every decision path keeps a
    // single shape. Readers (triage-cache-stats) recompute spend from token usage and
    // ignore this column. The ea_email_triage.estimated_cost_usd column can be dropped
    // in a future migration; do not start reading it as if it held real cost.
    estimated_cost_usd: null,
    latency_ms: null,
    cheap_model_result: null,
    strong_model_result: null,
    bill_candidate: null,
    decision_metadata: null,
    last_decision_reason: null,
    error: null,
    ...overrides,
  } as TriageDecision;
}

function normalizeLane(value: unknown): TriageLane {
  if (value === "actionable") return "needs_attention";
  if (value === "needs_attention" || value === "fyi" || value === "noise") return value;
  return "needs_attention";
}

function normalizeCategory(value: unknown): string {
  return String(value || "uncategorized").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function normalizeUrgency(value: unknown): TriageUrgency {
  if (value === "high" || value === "medium" || value === "normal" || value === "low") return value;
  return "normal";
}

function normalizeEscalationBadge(value: unknown, lane: TriageLane): string | null {
  if (lane !== "needs_attention") return null;
  const badge = String(value || "").trim();
  if (!badge || badge.toLowerCase() === "none") return null;
  return badge;
}

function modelUsageFromResult(result: Record<string, unknown>, tier: TriageModelTier): Record<string, unknown> {
  const usage = isRecord(result.usage)
    ? result.usage
    : isRecord(result.model_usage) ? result.model_usage : {};
  if (!Object.keys(usage).length) return {};
  return { [tier]: usage };
}

export function normalizeModelDecision(result: TriageModelResult | Record<string, unknown>, tier: TriageModelTier): TriageDecision {
  const decision = isRecord(result.decision) ? result.decision : result;
  const lane = normalizeLane(decision.lane);
  return createTriageDecision({
    lane,
    category: normalizeCategory(decision.category),
    urgency: normalizeUrgency(decision.urgency),
    escalation_badge: normalizeEscalationBadge(decision.escalation_badge, lane),
    summary: String(decision.summary || "Needs review."),
    action: String(decision.action || "Review"),
    deadline_at: decision.deadline_at ? String(decision.deadline_at) : null,
    confidence: Number.isFinite(Number(decision.confidence))
      ? Number(decision.confidence)
      : null,
    triage_source: tier === "cheap" ? "cheap_model" : "strong_model",
    model_usage: modelUsageFromResult(result, tier),
    // estimated_cost_usd intentionally not derived from the model result: the model
    // client never returns a cost, so this only ever produced null while looking like
    // a real money value. Left at the createTriageDecision default (null). See P3-69.
    latency_ms: Number.isFinite(Number(result.latency_ms)) ? Number(result.latency_ms) : null,
    cheap_model_result: tier === "cheap" ? result : null,
    strong_model_result: tier === "strong" ? result : null,
    bill_candidate: isRecord(decision.bill_candidate)
      ? decision.bill_candidate
      : isRecord(result.bill_candidate) ? result.bill_candidate : null,
  });
}

export function fallbackDecision(email: Partial<TriageEmail>, err: Error): TriageDecision {
  return createTriageDecision({
    lane: "needs_attention",
    category: "uncategorized",
    urgency: "high",
    escalation_badge: "Needs Review",
    summary: email.body_snippet || email.subject || "Triage failed; review the provider message.",
    action: "Review",
    confidence: 0,
    triage_source: "failure_fallback",
    last_decision_reason: "failure_fallback",
    error: err.message,
  });
}

export function triageDecisionFromPreflight(preflight: Partial<TriagePreflightResult> | null | undefined): TriageDecision | null {
  if (!preflight || preflight.action !== "finalize") return null;
  return createTriageDecision({
    lane: preflight.lane as TriageLane,
    category: preflight.category,
    urgency: preflight.urgency,
    escalation_badge: preflight.escalation_badge,
    summary: preflight.summary,
    action: preflight.decisionAction,
    deadline_at: preflight.deadline_at,
    confidence: preflight.confidence,
    triage_source: "rule",
    rule_id: preflight.ruleId,
    decision_metadata: preflightDecisionMetadata(preflight as TriagePreflightResult),
  });
}
