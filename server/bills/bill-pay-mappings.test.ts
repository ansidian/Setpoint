import { describe, expect, it } from "vitest";
import {
  DEFAULT_BILL_PAY_MAPPINGS,
  normalizeBillPayMappings,
  parseBillPayMappingsJson,
} from "./bill-pay-mappings.ts";

describe("Bill Pay mapping settings", () => {
  it("normalizes missing settings to the empty v2 mapping document", () => {
    expect(normalizeBillPayMappings(null)).toEqual(DEFAULT_BILL_PAY_MAPPINGS);
    expect(parseBillPayMappingsJson(null)).toEqual(DEFAULT_BILL_PAY_MAPPINGS);
  });

  describe("parseBillPayMappingsJson", () => {
    it("falls back to the default document on malformed JSON instead of throwing", () => {
      expect(parseBillPayMappingsJson("{not valid json")).toEqual(DEFAULT_BILL_PAY_MAPPINGS);
    });

    it("parses a well-formed JSON string into a normalized mapping document", () => {
      const doc = {
        version: 2,
        profiles: [{ id: "edison", enabled: false }],
      };
      expect(parseBillPayMappingsJson(JSON.stringify(doc))).toEqual({
        version: 2,
        profiles: [{ id: "edison", enabled: false, identity: {}, behaviors: [] }],
      });
    });
  });
});
