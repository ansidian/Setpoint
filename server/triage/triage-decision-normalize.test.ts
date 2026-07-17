import { describe, expect, it } from "vitest";
import {
  createTriageDecision,
  fallbackDecision,
  noModelDecision,
  normalizeModelDecision,
  triageDecisionFromPreflight,
} from "./triage-decision-normalize.ts";
import { evaluateTriagePreflight } from "./triage-preflight.ts";

const CANONICAL_KEYS = Object.keys(createTriageDecision()).sort();

const email = {
  subject: "Statement ready",
  body_snippet: "Your statement is ready to view.",
};

function finalizingPreflight() {
  return evaluateTriagePreflight(
    {
      subject: "Weekend sale - 40% off",
      body_snippet: "Unsubscribe any time.",
      from_address: "deals@deals.example",
    },
    {
      rules: [{
        id: 7,
        lane: "noise",
        category: "marketing",
        priority: 1,
        match_json: JSON.stringify({
          from_domains: ["deals.example"],
          subject_includes: ["sale"],
        }),
      }],
      includeDefaults: false,
    },
  );
}

describe("triage decision normalization", () => {
  it("converges model, fallback, no-model, and preflight paths on one shape", () => {
    const model = normalizeModelDecision({
      decision: { lane: "fyi", category: "updates", confidence: 0.9 },
      usage: { input_tokens: 10 },
    }, "cheap");
    const fallback = fallbackDecision(email, new Error("model unavailable"));
    const noModel = noModelDecision(email);
    const preflight = triageDecisionFromPreflight(finalizingPreflight());

    expect(preflight).not.toBeNull();
    for (const decision of [model, fallback, noModel, preflight]) {
      expect(Object.keys(decision!).sort()).toEqual(CANONICAL_KEYS);
    }
  });

  it("normalizes legacy and invalid model decision fields", () => {
    const decision = normalizeModelDecision({
      decision: {
        lane: "actionable",
        category: "School Stuff!",
        urgency: "panic",
        escalation_badge: "High Risk",
        confidence: "not-a-number",
      },
      usage: { input_tokens: 12, output_tokens: 3 },
      latency_ms: 80,
    }, "strong");

    expect(decision).toMatchObject({
      lane: "needs_attention",
      category: "school_stuff_",
      urgency: "normal",
      escalation_badge: "High Risk",
      summary: "Needs review.",
      action: "Review",
      confidence: null,
      triage_source: "strong_model",
      model_usage: { strong: { input_tokens: 12, output_tokens: 3 } },
      latency_ms: 80,
      cheap_model_result: null,
    });
    expect(decision.strong_model_result).toMatchObject({ latency_ms: 80 });
  });

  it("never carries a misleading estimated_cost_usd from the model result (P3-69)", () => {
    // The model client never returns a real per-email cost. A result that smuggles one
    // in must not masquerade as real spend; the normalized decision stays null.
    const withFakeCost = normalizeModelDecision({
      decision: { lane: "fyi", category: "updates", confidence: 0.9 },
      usage: { input_tokens: 10 },
      estimated_cost_usd: 0.004,
    }, "cheap");
    const withoutCost = normalizeModelDecision({
      decision: { lane: "fyi", category: "updates", confidence: 0.9 },
      usage: { input_tokens: 10 },
    }, "cheap");

    expect(withFakeCost.estimated_cost_usd).toBeNull();
    expect(withoutCost.estimated_cost_usd).toBeNull();
  });

  it("drops escalation badges outside needs_attention and treats 'none' as null", () => {
    const offLane = normalizeModelDecision({
      decision: { lane: "fyi", escalation_badge: "High Risk", confidence: 0.9 },
    }, "cheap");
    const noneBadge = normalizeModelDecision({
      decision: { lane: "needs_attention", escalation_badge: "none", confidence: 0.9 },
    }, "cheap");

    expect(offLane.escalation_badge).toBeNull();
    expect(noneBadge.escalation_badge).toBeNull();
  });

  it("fails open with a recorded failure reason", () => {
    const decision = fallbackDecision(email, new Error("model unavailable"));

    expect(decision).toMatchObject({
      lane: "needs_attention",
      urgency: "high",
      escalation_badge: "Needs Review",
      summary: "Your statement is ready to view.",
      confidence: 0,
      triage_source: "failure_fallback",
      last_decision_reason: "failure_fallback",
      error: "model unavailable",
    });
  });

  it("keeps noModelDecision as a labeled legacy fallback distinct from the heuristic path", () => {
    const decision = noModelDecision(email);

    expect(decision).toMatchObject({
      lane: "needs_attention",
      urgency: "normal",
      escalation_badge: "Needs Review",
      triage_source: "no_model_fallback",
      last_decision_reason: "no_model_legacy_fallback",
      confidence: null,
    });
    // Legacy fallback must never share the heuristic scorer's source label, or
    // the two no_model paths would be indistinguishable in stored decisions.
    expect(decision.triage_source).not.toBe("no_model_heuristic");
  });

  it("converts finalizing preflight results and rejects routing results", () => {
    const result = finalizingPreflight();
    expect(result.action).toBe("finalize");

    const decision = triageDecisionFromPreflight(result);
    expect(decision).toMatchObject({
      lane: "noise",
      category: "marketing",
      triage_source: "rule",
      rule_id: 7,
      action: "Ignore",
    });
    expect(decision!.decision_metadata).toMatchObject({
      preflight: { action: "finalize", ruleId: 7 },
    });

    expect(triageDecisionFromPreflight(null)).toBeNull();
    expect(triageDecisionFromPreflight({ action: "route_model" })).toBeNull();
  });
});
