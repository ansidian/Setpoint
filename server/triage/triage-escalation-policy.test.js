import { describe, expect, it } from "vitest";
import {
  CHEAP_CONFIDENCE_FLOOR,
  cheapEscalationReason,
  shouldEscalateCheap,
} from "./triage-escalation-policy.js";

function confidentDecision(overrides = {}) {
  return {
    lane: "fyi",
    category: "updates",
    urgency: "normal",
    escalation_badge: null,
    confidence: 0.9,
    ...overrides,
  };
}

describe("triage escalation policy", () => {
  it("escalates when confidence is missing or below the floor", () => {
    expect(cheapEscalationReason(confidentDecision({ confidence: null })))
      .toBe("cheap_confidence_below_floor");
    expect(cheapEscalationReason(confidentDecision({ confidence: 0.71 })))
      .toBe("cheap_confidence_below_floor");
    expect(cheapEscalationReason(confidentDecision({ confidence: CHEAP_CONFIDENCE_FLOOR })))
      .toBeNull();
  });

  it("escalates any decision carrying an escalation badge", () => {
    expect(cheapEscalationReason(confidentDecision({ escalation_badge: "High Risk" })))
      .toBe("cheap_escalation_badge");
  });

  it("escalates high-urgency decisions", () => {
    expect(cheapEscalationReason(confidentDecision({ urgency: "high" })))
      .toBe("cheap_urgency_high");
  });

  it("escalates needs_attention decisions in risk categories only", () => {
    expect(cheapEscalationReason(confidentDecision({
      lane: "needs_attention",
      category: "finance",
    }))).toBe("cheap_risk_category");
    expect(cheapEscalationReason(confidentDecision({
      lane: "fyi",
      category: "finance",
    }))).toBeNull();
    expect(cheapEscalationReason(confidentDecision({
      lane: "needs_attention",
      category: "personal",
    }))).toBeNull();
  });

  it("reports the highest-priority reason when several apply", () => {
    expect(cheapEscalationReason(confidentDecision({
      confidence: 0.1,
      escalation_badge: "High Risk",
      urgency: "high",
    }))).toBe("cheap_confidence_below_floor");
  });

  it("keeps shouldEscalateCheap consistent with the reason", () => {
    const confident = confidentDecision();
    const shaky = confidentDecision({ confidence: 0.2 });
    expect(shouldEscalateCheap(confident)).toBe(false);
    expect(shouldEscalateCheap(shaky)).toBe(true);
  });
});
