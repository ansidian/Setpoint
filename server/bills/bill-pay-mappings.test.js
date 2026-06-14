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
});
