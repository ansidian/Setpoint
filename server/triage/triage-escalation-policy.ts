export const CHEAP_CONFIDENCE_FLOOR = 0.72;
export const RISK_CATEGORIES = new Set(["finance", "security", "legal", "school"]);

// Checks run in priority order; the first match is the recorded reason.
interface CheapEscalationDecision {
  confidence?: number | null;
  escalation_badge?: unknown;
  urgency?: unknown;
  lane?: unknown;
  category?: unknown;
}

export function cheapEscalationReason(decision: CheapEscalationDecision): string | null {
  if (decision.confidence == null || decision.confidence < CHEAP_CONFIDENCE_FLOOR) {
    return "cheap_confidence_below_floor";
  }
  if (decision.escalation_badge) return "cheap_escalation_badge";
  if (decision.urgency === "high") return "cheap_urgency_high";
  if (decision.lane === "needs_attention" && RISK_CATEGORIES.has(String(decision.category || ""))) {
    return "cheap_risk_category";
  }
  return null;
}

export function shouldEscalateCheap(decision: CheapEscalationDecision): boolean {
  return cheapEscalationReason(decision) !== null;
}
