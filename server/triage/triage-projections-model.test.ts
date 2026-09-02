import { describe, expect, it } from "vitest";
import {
  normalizeEmailInterests,
  triageSoundTriggerType,
  emailTriageEventDetails,
} from "./triage-projections-model.ts";

describe("triage projections model", () => {
  it("normalizeEmailInterests parses a JSON string, trims, drops blanks", () => {
    expect(normalizeEmailInterests('["  tax ", "", "school"]')).toEqual(["tax", "school"]);
    expect(normalizeEmailInterests("not json")).toEqual([]);
    expect(normalizeEmailInterests(["a", " "])).toEqual(["a"]);
  });

  it("triageSoundTriggerType maps reasons/lanes", () => {
    expect(triageSoundTriggerType("email_triage_failed")).toBe("triage_failed");
    expect(triageSoundTriggerType("email_triage_finalized", "needs_attention")).toBe("needs_attention_finalized");
    expect(triageSoundTriggerType("email_triage_finalized", "fyi")).toBe("fyi_finalized");
    expect(triageSoundTriggerType("anything_else")).toBe("triage_event");
  });

  it("emailTriageEventDetails builds the stable eventKey + payload", () => {
    expect(emailTriageEventDetails(
      {
        account_id: "gmail-work",
        email_id: "msg-1",
        email_date_utc: "2026-05-05T00:00:00.000Z",
      },
      { reason: "email_triage_finalized", lane: "fyi", triageSource: "cheap_model" },
    )).toEqual({
      triggerType: "fyi_finalized",
      eventKey: "email_triage:gmail-work:msg-1:email_triage_finalized",
      emailId: "msg-1", lane: "fyi", triageSource: "cheap_model",
      reason: "email_triage_finalized",
      emailReceivedAt: "2026-05-05T00:00:00.000Z",
    });
  });
});
