import { describe, expect, it, vi } from "vitest";
import type { BillExtractionProvider } from "../../shared/types/bills.ts";
import {
  currencyValuesInText,
  shouldVerifyBillAmounts,
  verifyBillAmounts,
} from "./billAmountVerifier.ts";

function providerWith(fields: Record<string, unknown>): BillExtractionProvider {
  return {
    extract: vi.fn(async () => ({ fields, usage: { input_tokens: 10 } })),
  } as BillExtractionProvider;
}

describe("semantic bill amount verifier", () => {
  it("audits an inconsistent selection even when candidate coverage is complete", () => {
    expect(shouldVerifyBillAmounts(
      "Minimum payment $40.00. Statement balance $391.20.",
      {
        amount: 40,
        amount_kind: "payment_amount",
        amount_candidates: [
          { kind: "minimum_due", value: 40 },
          { kind: "statement_balance", value: 391.2 },
        ],
      },
    )).toBe(true);
  });

  it("repairs an invalid selection from complete semantic candidates", async () => {
    const result = await verifyBillAmounts({
      content: "Minimum payment $40.00. Statement balance $391.20.",
      candidate: {
        event_kind: "payment_scheduled",
        amount: 40,
        amount_kind: "payment_amount",
        amount_candidates: [
          { kind: "minimum_due", value: 40 },
          { kind: "statement_balance", value: 391.2 },
        ],
      },
      provider: providerWith({}),
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      amount: 391.2,
      amount_kind: "statement_balance",
      amount_verification: { status: "corrected" },
    });
  });

  it("makes statement balance canonical even when another non-minimum amount was selected", async () => {
    const result = await verifyBillAmounts({
      content: "Payment amount $40.00. Statement balance $391.20.",
      candidate: {
        event_kind: "payment_completed",
        amount: 40,
        amount_kind: "payment_amount",
        amount_candidates: [
          { kind: "payment_amount", value: 40 },
          { kind: "statement_balance", value: 391.2 },
        ],
      },
      provider: providerWith({}),
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      amount: 391.2,
      amount_kind: "statement_balance",
      amount_verification: { status: "corrected" },
    });
  });

  it("uses currency tokens only as a bounded completeness inventory", () => {
    expect(currencyValuesInText("Minimum $40.00, plan $0.00, balance 391.20 USD, duplicate $40")).toEqual([
      40,
      0,
      391.2,
    ]);
    expect(shouldVerifyBillAmounts("Only $40.00", {
      amount: 40,
      amount_kind: "minimum_due",
      amount_candidates: [{ kind: "minimum_due", value: 40 }],
    })).toBe(false);
  });

  it("accepts a verifier that recovers a missing statement balance", async () => {
    const result = await verifyBillAmounts({
      content: "Minimum payment $40.00. Plan balance $0.00. Remaining statement balance $391.20.",
      candidate: {
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40 }],
        payee_hint: "Example Bank",
      },
      provider: providerWith({
        amount: 391.2,
        amount_kind: "statement_balance",
        amount_candidates: [
          { kind: "minimum_due", value: 40 },
          { kind: "other", value: 0 },
          { kind: "statement_balance", value: 391.2 },
        ],
      }),
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      payee_hint: "Example Bank",
      amount: 391.2,
      amount_kind: "statement_balance",
      amount_verification: {
        status: "corrected",
        source_value_count: 3,
        initial_covered_count: 1,
        verified_covered_count: 3,
      },
    });
  });

  it("never restores a minimum-due selection when verification does not improve evidence", async () => {
    const result = await verifyBillAmounts({
      content: "Minimum payment $40.00. Statement balance $391.20.",
      candidate: {
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40 }],
      },
      provider: providerWith({
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40 }],
      }),
      providerId: "openai",
      model: "test-model",
    });
    expect(result.candidate.amount).toBeNull();
    expect(result.candidate.amount_kind).toBeNull();
    expect(result.candidate.amount_verification?.status).toBe("kept_initial");
  });

  it("fails closed instead of restoring minimum due when the verifier is unavailable", async () => {
    const provider = { extract: vi.fn(async () => { throw new Error("offline"); }) } as BillExtractionProvider;
    const result = await verifyBillAmounts({
      content: "Minimum $40.00. Balance $391.20.",
      candidate: { amount: 40, amount_kind: "minimum_due", amount_candidates: [{ kind: "minimum_due", value: 40 }] },
      provider,
      providerId: "openai",
      model: "test-model",
    });
    expect(result.candidate.amount).toBeNull();
    expect(result.candidate.amount_kind).toBeNull();
    expect(result.candidate.amount_verification?.status).toBe("failed");
  });

  it("keeps minimum due as evidence but never selects it when it is the only amount", async () => {
    const provider = {
      extract: vi.fn(async () => { throw new Error("single minimum should not trigger verification"); }),
    } as BillExtractionProvider;
    const result = await verifyBillAmounts({
      content: "Minimum payment $40.00.",
      candidate: {
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40 }],
      },
      provider,
      providerId: "openai",
      model: "test-model",
    });

    expect(result.candidate).toMatchObject({
      amount: null,
      amount_kind: null,
      amount_candidates: [{ kind: "minimum_due", value: 40 }],
      amount_verification: { status: "corrected" },
    });
  });
});
