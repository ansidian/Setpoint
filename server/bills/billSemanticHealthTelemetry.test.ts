import { describe, expect, it } from "vitest";
import { billSemanticHealthTelemetry } from "./billSemanticHealthTelemetry.ts";

describe("bill semantic health telemetry", () => {
  it("reports semantic health through a stable fingerprint without sensitive bill data", () => {
    const telemetry = billSemanticHealthTelemetry({
      userId: "owner@example.com",
      accountId: "gmail-primary",
      emailId: "opaque-provider-message-id",
      source: "triage",
      persistence: "newly_persisted",
      resolution: {
        bill: {
          event_kind: "payment_due",
          amount: 187.42,
          event_evidence: "Your statement balance is due",
          amount_verification: { status: "corrected", source_value_count: 2, initial_covered_count: 1 },
          event_verification: { status: "kept_initial", provider: "openai", model: "model" },
          target_verification: { status: "selected", option_count: 2 },
          category_id: "actual-category-id",
        },
        mapping: {
          status: "matched",
          reason: "semantic_event_match",
          profileId: "private-profile-id",
          behaviorId: "private-behavior-id",
        },
      },
    });
    const serialized = JSON.stringify(telemetry);

    expect(telemetry).toEqual({
      event: "bill_semantic_health",
      email_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      source: "triage",
      event_kind: "payment_due",
      mapping_status: "matched",
      mapping_reason: "semantic_event_match",
      amount_verification: "corrected",
      event_verification: "kept_initial",
      target_verification: "selected",
      enrichment_persistence: "newly_persisted",
    });
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("opaque-provider-message-id");
    expect(serialized).not.toContain("187.42");
    expect(serialized).not.toContain("statement balance");
    expect(serialized).not.toContain("private-profile-id");
    expect(serialized).not.toContain("private-behavior-id");
    expect(serialized).not.toContain("actual-category-id");
  });

  it("does not emit a partial identity fingerprint", () => {
    const telemetry = billSemanticHealthTelemetry({
      userId: "u1",
      source: "pasted_text",
      persistence: "not_persisted",
      resolution: { bill: {}, mapping: { status: "unmapped" } },
    });

    expect(telemetry.email_fingerprint).toBeNull();
  });
});
