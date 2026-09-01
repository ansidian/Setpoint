import { describe, expect, it } from "vitest";
import { trimBillBody } from "./bill-extract.ts";

describe("trimBillBody", () => {
  it("preserves a separated statement-balance block beyond the former evidence cutoff", () => {
    const prefix = Array.from({ length: 70 }, (_, index) => `Account notice ${index}: payment information`).join("\n");
    const result = trimBillBody({
      subject: "Payment due",
      from: "billing@example.test",
      body: `${prefix}\nMinimum payment\n$40.00\nRemaining statement balance\n$0.00\n$391.20`,
    });

    expect(result).toContain("Remaining statement balance");
    expect(result).toContain("$391.20");
    expect(result.length).toBeLessThanOrEqual(3500);
  });
});
