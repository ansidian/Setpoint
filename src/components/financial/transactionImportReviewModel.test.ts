import { describe, expect, it } from "vitest";
import { formatImportAmount } from "./transactionImportReviewModel";

describe("transaction import review model", () => {
  it("projects signed amounts", () => {
    expect(formatImportAmount(-700)).toBe("-$7.00");
    expect(formatImportAmount(null)).toBe("Amount unavailable");
  });
});
