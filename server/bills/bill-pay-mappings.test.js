import { describe, expect, it } from "vitest";
import {
  DEFAULT_BILL_PAY_MAPPINGS,
  normalizeBillPayMappings,
  parseBillPayMappingsJson,
  validateBillPayMappings,
} from "./bill-pay-mappings.js";

describe("Bill Pay mapping settings", () => {
  it("normalizes missing settings to the empty v1 mapping document", () => {
    expect(normalizeBillPayMappings(null)).toEqual(DEFAULT_BILL_PAY_MAPPINGS);
    expect(parseBillPayMappingsJson(null)).toEqual(DEFAULT_BILL_PAY_MAPPINGS);
  });

  it("rejects invalid enabled profiles and behaviors with useful messages", () => {
    expect(validateBillPayMappings({ version: 2, profiles: [] })).toEqual({
      valid: false,
      message: "Invalid bill_pay_mappings version",
    });

    expect(validateBillPayMappings({
      version: 1,
      profiles: [{ id: "edison", enabled: true, behaviors: [] }],
    })).toEqual({
      valid: false,
      message: "Enabled bill_pay_mappings profile requires identity matchers",
    });

    expect(validateBillPayMappings({
      version: 1,
      profiles: [{
        id: "edison",
        enabled: true,
        identity: { aliases: ["edison"] },
        behaviors: [{ id: "autopay", enabled: true, type: "expense" }],
      }],
    })).toEqual({
      valid: false,
      message: "Enabled bill_pay_mappings behavior requires intent matchers",
    });
  });

  it("allows disabled incomplete profiles and behaviors as drafts", () => {
    expect(validateBillPayMappings({
      version: 1,
      profiles: [{
        id: "draft-profile",
        enabled: false,
        behaviors: [{ id: "draft-behavior", enabled: false }],
      }],
    })).toEqual({ valid: true });
  });

  // Helpers that build the smallest valid document, then let a case mutate
  // exactly one behavior field, so each rejection message is isolated.
  const behaviorWith = (overrides) => ({
    id: "autopay",
    enabled: true,
    type: "expense",
    intent: { subject: ["statement"] },
    ...overrides,
  });
  const docWithBehavior = (behavior) => ({
    version: 1,
    profiles: [{
      id: "edison",
      enabled: true,
      identity: { aliases: ["edison"] },
      behaviors: [behavior],
    }],
  });

  describe("rejects each malformed behavior field with its exact message", () => {
    const cases = [
      {
        name: "unknown target field",
        behavior: behaviorWith({ targets: { not_a_real_field: "x" } }),
        message: "Invalid bill_pay_mappings behavior target field",
      },
      {
        name: "non-string target value",
        behavior: behaviorWith({ targets: { payee_id: 1234 } }),
        message: "Invalid bill_pay_mappings behavior target",
      },
      {
        name: "targets that are not an object",
        behavior: behaviorWith({ targets: ["payee_id"] }),
        message: "Invalid bill_pay_mappings behavior targets",
      },
      {
        name: "unknown amount strategy",
        behavior: behaviorWith({ amountStrategy: "average_due" }),
        message: "Invalid bill_pay_mappings amount strategy",
      },
      {
        name: "unknown amount fallback",
        behavior: behaviorWith({ amountFallback: "guess_amount" }),
        message: "Invalid bill_pay_mappings amount fallback",
      },
    ];

    it.each(cases)("$name", ({ behavior, message }) => {
      expect(validateBillPayMappings(docWithBehavior(behavior))).toEqual({
        valid: false,
        message,
      });
    });
  });

  it("rejects a profile whose behaviors are not an array", () => {
    expect(validateBillPayMappings({
      version: 1,
      profiles: [{
        id: "edison",
        enabled: true,
        identity: { aliases: ["edison"] },
        behaviors: "autopay",
      }],
    })).toEqual({
      valid: false,
      message: "Invalid bill_pay_mappings profile behaviors",
    });
  });

  describe("nested-OR matcher groups", () => {
    it("accepts an identity matcher group of AND-grouped alternatives", () => {
      // ["sender"] satisfies single-string OR; [["a","b"]] satisfies a nested
      // all-non-blank AND group; together they form a valid OR-of-groups.
      expect(validateBillPayMappings({
        version: 1,
        profiles: [{
          id: "edison",
          enabled: true,
          identity: { aliases: [["edison", "pge"]] },
          behaviors: [behaviorWith({})],
        }],
      })).toEqual({ valid: true });
    });

    it("rejects a nested matcher group containing a blank alternative", () => {
      // The inner AND group must be all non-blank; one blank entry voids it.
      expect(validateBillPayMappings({
        version: 1,
        profiles: [{
          id: "edison",
          enabled: true,
          identity: { aliases: [["edison", "  "]] },
          behaviors: [behaviorWith({})],
        }],
      })).toEqual({
        valid: false,
        message: "Invalid bill_pay_mappings profile identity matcher",
      });
    });

    it("rejects an empty nested matcher group", () => {
      // A zero-length nested group is neither a string nor a valid AND group.
      expect(validateBillPayMappings({
        version: 1,
        profiles: [{
          id: "edison",
          enabled: true,
          identity: { aliases: [[]] },
          behaviors: [behaviorWith({})],
        }],
      })).toEqual({
        valid: false,
        message: "Invalid bill_pay_mappings profile identity matcher",
      });
    });

    it("treats a nested-only group as a satisfied identity matcher (hasAnyMatcher)", () => {
      // A profile whose only identity signal is a nested AND group still
      // counts as having identity matchers, so the enabled-profile gate passes.
      const result = validateBillPayMappings({
        version: 1,
        profiles: [{
          id: "edison",
          enabled: true,
          identity: { aliases: [["edison", "pge"]] },
          behaviors: [{ id: "draft", enabled: false }],
        }],
      });
      expect(result).toEqual({ valid: true });
    });
  });

  describe("parseBillPayMappingsJson", () => {
    it("falls back to the default document on malformed JSON instead of throwing", () => {
      expect(parseBillPayMappingsJson("{not valid json")).toEqual(DEFAULT_BILL_PAY_MAPPINGS);
    });

    it("parses a well-formed JSON string into a normalized mapping document", () => {
      const doc = {
        version: 1,
        profiles: [{ id: "edison", enabled: false }],
      };
      expect(parseBillPayMappingsJson(JSON.stringify(doc))).toEqual(doc);
    });
  });
});
