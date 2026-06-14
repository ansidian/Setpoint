import { describe, expect, it } from "vitest";
import { createTriageDecision } from "./triage-decision-normalize.js";
import { heuristicNoModelDecision } from "./triage-heuristic-scorer.js";

const CANONICAL_KEYS = Object.keys(createTriageDecision()).sort();

function email(overrides = {}) {
  return {
    user_id: "user-1",
    account_id: "gmail-work",
    from_name: "",
    from_address: "",
    subject: "",
    body_snippet: "",
    body_text: "",
    ...overrides,
  };
}

describe("heuristic no-model scorer", () => {
  const cases = [
    {
      name: "no-reply newsletter with unsubscribe body -> noise",
      input: email({
        from_name: "Acme Newsletter",
        from_address: "newsletter@acme.example",
        subject: "This week at Acme",
        body_snippet: "Top stories. Unsubscribe any time.",
      }),
      lane: "noise",
    },
    {
      name: "noreply localpart alone -> noise",
      input: email({
        from_name: "Acme",
        from_address: "no-reply@acme.example",
        subject: "Your weekly digest",
        body_snippet: "Here is what happened.",
      }),
      lane: "noise",
    },
    {
      name: "unsubscribe cue only in body_text -> noise",
      input: email({
        from_name: "Promo",
        from_address: "hello@promo.example",
        subject: "Big sale",
        body_snippet: "Limited time.",
        body_text: "Shop now. To manage preferences or unsubscribe, click here.",
      }),
      lane: "noise",
    },
    {
      name: "action-required subject -> needs_attention",
      input: email({
        from_name: "Login Service",
        from_address: "alerts@login.example",
        subject: "Action required: verify your login",
        body_snippet: "Confirm it was you.",
      }),
      lane: "needs_attention",
    },
    {
      name: "invoice subject -> needs_attention",
      input: email({
        from_name: "Billing",
        from_address: "ar@vendor.example",
        subject: "Invoice 4821 past due",
        body_snippet: "Payment is overdue.",
      }),
      lane: "needs_attention",
    },
    {
      name: "plain human note, named sender, no cues -> fyi",
      input: email({
        from_name: "Dana Lee",
        from_address: "dana@friend.example",
        subject: "Lunch next week?",
        body_snippet: "Are you around Tuesday?",
      }),
      lane: "fyi",
    },
    {
      name: "empty/garbage email -> fyi",
      input: email(),
      lane: "fyi",
    },
  ];

  for (const { name, input, lane } of cases) {
    it(`scores: ${name}`, () => {
      const decision = heuristicNoModelDecision(input);
      expect(decision.lane).toBe(lane);
      expect(decision.triage_source).toBe("no_model_heuristic");
      expect(typeof decision.last_decision_reason).toBe("string");
      expect(decision.last_decision_reason.length).toBeGreaterThan(0);
    });
  }

  it("returns the canonical decision shape", () => {
    const decision = heuristicNoModelDecision(email({ subject: "Invoice past due" }));
    expect(Object.keys(decision).sort()).toEqual(CANONICAL_KEYS);
  });

  it("never sets an escalation badge outside needs_attention", () => {
    const fyi = heuristicNoModelDecision(email({ from_name: "Dana", subject: "hi" }));
    expect(fyi.escalation_badge).toBeNull();
  });

  it("is deterministic: same email twice yields the same lane and reason", () => {
    const input = email({
      from_name: "Acme Newsletter",
      from_address: "newsletter@acme.example",
      subject: "This week at Acme",
      body_snippet: "Unsubscribe any time.",
    });
    const a = heuristicNoModelDecision(input);
    const b = heuristicNoModelDecision(input);
    expect(a.lane).toBe(b.lane);
    expect(a.last_decision_reason).toBe(b.last_decision_reason);
  });

  it("falls back to fyi when scoring throws (never recreates the pile-up)", () => {
    // Force a throw mid-scoring via a property getter that raises. The guard must
    // degrade to fyi, never needs_attention — a scorer bug must not recreate the
    // pile-up. (A null/empty email does NOT throw: the scorer is null-safe and
    // scores to fyi via the happy path; case "empty/garbage email" covers that.)
    const hostile = {
      from_name: "x",
      from_address: "x@example.com",
      get subject() { throw new Error("boom"); },
      body_snippet: "",
      body_text: "",
    };
    const decision = heuristicNoModelDecision(hostile);
    expect(decision.lane).toBe("fyi");
    expect(decision.triage_source).toBe("no_model_heuristic");
    expect(decision.last_decision_reason).toBe("heuristic_scorer_error");
  });
});
