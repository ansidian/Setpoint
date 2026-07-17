import { describe, expect, it } from "vitest";
import {
  emailSearchText,
  normalizeEmailInterests,
  maybeBillCandidate,
  triageSoundTriggerType,
  emailTriageEventDetails,
  weakSecurityReadDecision,
} from "./triage-projections-model.ts";

describe("triage projections model", () => {
  it("emailSearchText lowercases and newline-joins the five fields", () => {
    const text = emailSearchText({
      from_name: "Util CO", from_address: "Billing@Util.example",
      subject: "Payment DUE", body_snippet: "Snip", body_text: "Body $120",
    });
    expect(text).toBe("util co\nbilling@util.example\npayment due\nsnip\nbody $120");
  });

  it("normalizeEmailInterests parses a JSON string, trims, drops blanks", () => {
    expect(normalizeEmailInterests('["  tax ", "", "school"]')).toEqual(["tax", "school"]);
    expect(normalizeEmailInterests("not json")).toEqual([]);
    expect(normalizeEmailInterests(["a", " "])).toEqual(["a"]);
  });

  it("maybeBillCandidate returns the decision's own bill_candidate when present", () => {
    const bc = { source: "model" };
    expect(maybeBillCandidate({}, { bill_candidate: bc })).toBe(bc);
  });

  it("maybeBillCandidate returns null when the text is not financial", () => {
    expect(maybeBillCandidate(
      { subject: "Hello", body_text: "lunch?" }, { category: "personal" },
    )).toBeNull();
  });

  it("maybeBillCandidate builds a triage candidate for financial finance mail", () => {
    const candidate = maybeBillCandidate(
      { from_name: "Util", from_address: "b@u.example", subject: "Bill", body_text: "Pay $40 due" },
      { category: "finance", deadline_at: "2026-05-08" },
    );
    expect(candidate).toEqual({
      source: "triage", payee_hint: "Util", subject: "Bill",
      amount: null, due_date: "2026-05-08", requires_confirmation: true,
    });
  });

  it("maybeBillCandidate requires an explicit $ amount when category is not finance", () => {
    expect(maybeBillCandidate(
      { subject: "Statement", body_text: "your statement is ready" },
      { category: "updates" },
    )).toBeNull();
    expect(maybeBillCandidate(
      { subject: "Statement", body_text: "your statement $9 is ready" },
      { category: "updates" },
    )).not.toBeNull();
  });

  it("triageSoundTriggerType maps reasons/lanes", () => {
    expect(triageSoundTriggerType("weak_security_grace_delayed")).toBe("weak_security_grace");
    expect(triageSoundTriggerType("email_triage_failed")).toBe("triage_failed");
    expect(triageSoundTriggerType("email_triage_finalized", "needs_attention")).toBe("needs_attention_finalized");
    expect(triageSoundTriggerType("email_triage_finalized", "fyi")).toBe("fyi_finalized");
    expect(triageSoundTriggerType("anything_else")).toBe("triage_event");
  });

  it("emailTriageEventDetails builds the stable eventKey + payload", () => {
    expect(emailTriageEventDetails(
      { account_id: "gmail-work", email_id: "msg-1" },
      { reason: "email_triage_finalized", lane: "fyi", triageSource: "cheap_model" },
    )).toEqual({
      triggerType: "fyi_finalized",
      eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
      emailId: "msg-1", lane: "fyi", triageSource: "cheap_model",
      reason: "email_triage_finalized",
    });
  });

  it("weakSecurityReadDecision returns the fyi/security read decision", () => {
    const d = weakSecurityReadDecision();
    expect(d).toMatchObject({
      lane: "fyi", category: "security", urgency: "low",
      triage_source: "weak_security_grace_read",
      last_decision_reason: "weak_security_grace_read",
      decision_metadata: { weakSecurityGrace: { outcome: "read_in_inbox", modelSaved: true } },
    });
  });
});
