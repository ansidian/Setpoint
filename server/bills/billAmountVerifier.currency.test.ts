import { describe, expect, it } from "vitest";
import type { BillCandidate } from "../../shared/types/bills.ts";
import { shouldVerifyBillAmounts, verifyBillAmounts } from "./billAmountVerifier.ts";
import { selectSemanticBillAmount } from "./billSemanticAmountPolicy.ts";

const total: BillCandidate = {
  type: "expense", event_kind: "purchase", amount: 26.52, amount_kind: "transaction_amount",
  amount_candidates: [{ kind: "transaction_amount", value: 26.52, evidence: "Total $26.52 USD" }],
};
const failedAudit: BillCandidate = {
  ...total,
  amount_verification: {
    status: "failed", source_value_count: 2, initial_covered_count: 1, verified_covered_count: 1,
    provider: "anthropic", model: "fixture",
  },
};

async function verify(content: string, candidate = total) {
  return (await verifyBillAmounts({
    content, candidate, provider: { extract: async () => ({ fields: total, usage: {} }) },
    providerId: "anthropic", model: "fixture",
  })).candidate;
}

describe("receipt currency coverage", () => {
  it.each(["$26.52 USD", "US$26.52 USD", "$26.52\u00a0USD", "26.52 USD", "USD 26.52"])(
    "accepts a receipt total when quantity follows %s", async (unitPrice) => {
      const candidate = await verify(`Unit price   Qty   Amount\n${unitPrice}   1   $26.52 USD\nTotal $26.52 USD`);
      expect(selectSemanticBillAmount(candidate)?.amount).toBe(26.52);
    },
  );

  it("rechecks a saved failed audit when the currency inventory changes", async () => {
    const content = "Unit price   Qty   Amount\n$26.52 USD   1   $26.52 USD\nTotal $26.52 USD";
    expect(shouldVerifyBillAmounts(content, failedAudit)).toBe(true);
    const candidate = await verify(content, failedAudit);
    expect(selectSemanticBillAmount(candidate)?.amount).toBe(26.52);
    expect(candidate.amount_verification).toMatchObject({
      status: "corrected", source_value_count: 1, initial_covered_count: 1, verified_covered_count: 1,
    });
  });

  it.each(["USD 1.50", "1.50 USD", "$1.50", "US$1.50"])(
    "still rejects an unaccounted separate fee written as %s", async (fee) => {
      const candidate = await verify(`Total $26.52 USD\nService fee ${fee}`, failedAudit);
      expect(selectSemanticBillAmount(candidate)).toBeNull();
    },
  );

  it("preserves an independent USD amount on the following line", async () => {
    const candidate = await verify("Total $26.52\nUSD 1.50", failedAudit);
    expect(selectSemanticBillAmount(candidate)).toBeNull();
  });

  it("keeps adjacent USD-prefixed prices separate", async () => {
    const candidate = await verify("Total USD 26.52 USD 1.50", {
      ...failedAudit,
      amount_candidates: [{ kind: "transaction_amount", value: 26.52, evidence: "Total USD 26.52" }],
    });
    expect(selectSemanticBillAmount(candidate)).toBeNull();
  });

  it("preserves failed audits whose saved count does not match the previous scanner", async () => {
    const candidate = await verify("Total $26.52 USD", failedAudit);
    expect(selectSemanticBillAmount(candidate)).toBeNull();
  });

  it("does not attribute an excluded notification threshold to the tokenizer change", async () => {
    const content = "Subject: A transaction was made on your Costco Anywhere account\nFrom: alerts@info6.citi.com\n\n"
      + "You're receiving this email based on your custom alert settings.\n"
      + "The transaction made on your Costco Anywhere account exceeded $2.00.\nTotal $26.52 USD";
    expect(selectSemanticBillAmount(await verify(content, failedAudit))).toBeNull();
  });

  it("keeps a saved failed audit blocked when its amount label is ungrounded", async () => {
    const candidate = await verify("Unit price   Qty   Amount\n$26.52 USD   1   $26.52 USD\nSubtotal $26.52 USD", failedAudit);
    expect(selectSemanticBillAmount(candidate)).toBeNull();
  });
});
