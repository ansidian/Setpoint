import { preflightDecisionMetadata } from "./triage-preflight.js";

// Every triage decision — model, fallback, no-model, preflight — must flow
// through createTriageDecision so updateTriageRow always sees one shape.
export function createTriageDecision(overrides = {}) {
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
    estimated_cost_usd: null,
    latency_ms: null,
    cheap_model_result: null,
    strong_model_result: null,
    bill_candidate: null,
    decision_metadata: null,
    last_decision_reason: null,
    error: null,
    ...overrides,
  };
}

function normalizeLane(value) {
  if (value === "actionable") return "needs_attention";
  if (["needs_attention", "fyi", "noise"].includes(value)) return value;
  return "needs_attention";
}

function normalizeCategory(value) {
  return String(value || "uncategorized").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function normalizeUrgency(value) {
  if (["high", "medium", "normal", "low"].includes(value)) return value;
  return "normal";
}

function normalizeEscalationBadge(value, lane) {
  if (lane !== "needs_attention") return null;
  const badge = String(value || "").trim();
  if (!badge || badge.toLowerCase() === "none") return null;
  return badge;
}

function modelUsageFromResult(result, tier) {
  const usage = result?.usage || result?.model_usage || {};
  if (!Object.keys(usage).length) return {};
  return { [tier]: usage };
}

export function normalizeModelDecision(result, tier) {
  const decision = result?.decision || result || {};
  const lane = normalizeLane(decision.lane);
  return createTriageDecision({
    lane,
    category: normalizeCategory(decision.category),
    urgency: normalizeUrgency(decision.urgency),
    escalation_badge: normalizeEscalationBadge(decision.escalation_badge, lane),
    summary: String(decision.summary || "Needs review."),
    action: String(decision.action || "Review"),
    deadline_at: decision.deadline_at || null,
    confidence: Number.isFinite(Number(decision.confidence))
      ? Number(decision.confidence)
      : null,
    triage_source: tier === "cheap" ? "cheap_model" : "strong_model",
    model_usage: modelUsageFromResult(result, tier),
    estimated_cost_usd: Number.isFinite(Number(result?.estimated_cost_usd))
      ? Number(result.estimated_cost_usd)
      : null,
    latency_ms: Number.isFinite(Number(result?.latency_ms)) ? Number(result.latency_ms) : null,
    cheap_model_result: tier === "cheap" ? result : null,
    strong_model_result: tier === "strong" ? result : null,
    bill_candidate: decision.bill_candidate || result?.bill_candidate || null,
  });
}

export function fallbackDecision(email, err) {
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

export function noModelDecision(email) {
  return createTriageDecision({
    lane: "needs_attention",
    category: "uncategorized",
    urgency: "normal",
    escalation_badge: "Needs Review",
    summary: email.body_snippet || email.subject || "Review provider message.",
    action: "Review",
    triage_source: "no_model_fallback",
    last_decision_reason: "no_model_mode",
  });
}

export function triageDecisionFromPreflight(preflight) {
  if (!preflight || preflight.action !== "finalize") return null;
  return createTriageDecision({
    lane: preflight.lane,
    category: preflight.category,
    urgency: preflight.urgency,
    escalation_badge: preflight.escalation_badge,
    summary: preflight.summary,
    action: preflight.decisionAction,
    deadline_at: preflight.deadline_at,
    confidence: preflight.confidence,
    triage_source: "rule",
    rule_id: preflight.ruleId,
    decision_metadata: preflightDecisionMetadata(preflight),
  });
}
