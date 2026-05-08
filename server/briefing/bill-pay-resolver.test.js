import { describe, expect, it } from "vitest";
import { resolveBillPayMapping } from "./bill-pay-resolver.js";

const metadata = {
  accounts: [
    { id: "acct-checking", name: "Checking" },
    { id: "acct-card", name: "Visa 4242" },
  ],
  categories: [
    { id: "cat-utilities", name: "Utilities" },
    { id: "cat-internet", name: "Internet" },
  ],
  payees: [
    { id: "payee-edison", name: "Southern California Edison" },
    { id: "payee-spectrum", name: "Spectrum" },
  ],
};

describe("Bill Pay resolver", () => {
  it("applies the first matched behavior targets and extracts the configured amount", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 1,
        profiles: [{
          id: "edison",
          enabled: true,
          identity: {
            domain: ["sce.com"],
            last4: ["4242"],
          },
          behaviors: [{
            id: "statement-payment",
            enabled: true,
            type: "transfer",
            intent: {
              subject: ["payment"],
              body: ["statement balance"],
            },
            amountStrategy: "statement_balance",
            targets: {
              payee_id: "payee-edison",
              payee_label: "Southern California Edison",
              from_account_id: "acct-checking",
              from_account_label: "Checking",
              to_account_id: "acct-card",
              to_account_label: "Visa 4242",
              schedule_name: "Visa 4242",
            },
          }],
        }],
      },
      metadata,
      source: "triage",
      email: {
        from: "billing@sce.com",
        subject: "Payment reminder",
        body: "Account ending in 4242. Statement balance: $123.45. Minimum due: $25.00.",
      },
      candidate: {
        payee_hint: "SCE",
        amount: 99,
        due_date: "2026-05-20",
      },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "edison",
      behaviorId: "statement-payment",
      amountSource: "statement_balance",
    });
    expect(result.mapping).not.toHaveProperty("confidence");
    expect(result.bill).toMatchObject({
      type: "transfer",
      payee: "Southern California Edison",
      payee_id: "payee-edison",
      amount: 123.45,
      due_date: "2026-05-20",
      from_account_id: "acct-checking",
      to_account_id: "acct-card",
      schedule_name: "Visa 4242",
    });
  });

  it("continues past identity-only profiles when no behavior matches", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 1,
        profiles: [
          {
            id: "identity-only",
            enabled: true,
            identity: { aliases: ["spectrum"] },
            behaviors: [{
              id: "wrong-intent",
              enabled: true,
              type: "expense",
              intent: { subject: ["past due"] },
              targets: { payee_id: "payee-spectrum", payee_label: "Spectrum" },
            }],
          },
          {
            id: "spectrum",
            enabled: true,
            identity: { aliases: ["spectrum"] },
            behaviors: [{
              id: "monthly-internet",
              enabled: true,
              type: "expense",
              intent: { subject: ["statement ready"] },
              amountStrategy: "model_amount",
              targets: {
                payee_id: "payee-spectrum",
                payee_label: "Spectrum",
                category_id: "cat-internet",
                category_label: "Internet",
              },
            }],
          },
        ],
      },
      metadata,
      source: "triage",
      email: {
        from: "billing@spectrum.net",
        subject: "Your Spectrum statement ready",
        body: "Internet bill",
      },
      candidate: {
        payee_hint: "Spectrum",
        amount: 84.99,
        due_date: "2026-05-18",
      },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "spectrum",
      behaviorId: "monthly-internet",
    });
    expect(result.bill).toMatchObject({
      payee_id: "payee-spectrum",
      category_id: "cat-internet",
      amount: 84.99,
    });
  });

  it("preserves weak fallback fields when unmapped", () => {
    const result = resolveBillPayMapping({
      mappings: { version: 1, profiles: [] },
      metadata,
      source: "triage",
      email: { from: "notice@example.test", subject: "Notice", body: "" },
      candidate: {
        payee_hint: "Unknown Utility",
        amount: 12.34,
        due_date: "2026-05-22",
      },
    });

    expect(result.mapping).toEqual({
      status: "unmapped",
      reason: "no_profile_match",
      matchedProfiles: [],
    });
    expect(result.bill).toMatchObject({
      payee: "Unknown Utility",
      amount: 12.34,
      due_date: "2026-05-22",
      type: "expense",
    });
  });

  it("uses source-aware amount fallback when a text amount is not found", () => {
    const mappings = {
      version: 1,
      profiles: [{
        id: "utility",
        enabled: true,
        identity: { aliases: ["utility"] },
        behaviors: [{
          id: "minimum",
          enabled: true,
          type: "expense",
          intent: { subject: ["payment"] },
          amountStrategy: "minimum_due",
          targets: { payee_id: "payee-edison", payee_label: "Southern California Edison" },
        }],
      }],
    };

    const triaged = resolveBillPayMapping({
      mappings,
      metadata,
      source: "triage",
      email: { from: "billing@utility.test", subject: "Utility payment", body: "No amount in body." },
      candidate: { payee_hint: "Utility", amount: 44.5, due_date: "2026-05-25" },
    });
    const pastedText = resolveBillPayMapping({
      mappings,
      metadata,
      source: "pasted_text",
      email: { from: "billing@utility.test", subject: "Utility payment", body: "No amount in body." },
      candidate: { payee_hint: "Utility", amount: 44.5, due_date: "2026-05-25" },
    });

    expect(triaged.mapping).toMatchObject({ status: "matched", amountSource: "model_amount" });
    expect(triaged.bill.amount).toBe(44.5);
    expect(pastedText.mapping).toMatchObject({ status: "matched", amountSource: "blank" });
    expect(pastedText.bill.amount).toBeNull();
  });

  it("reports stale Actual targets without applying mapped IDs", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 1,
        profiles: [{
          id: "stale",
          enabled: true,
          identity: { aliases: ["edison"] },
          behaviors: [{
            id: "stale-target",
            enabled: true,
            type: "expense",
            intent: { subject: ["bill"] },
            amountStrategy: "model_amount",
            targets: {
              payee_id: "missing-payee",
              payee_label: "Old Payee",
              category_id: "cat-utilities",
              category_label: "Utilities",
            },
          }],
        }],
      },
      metadata,
      source: "triage",
      email: { from: "billing@sce.com", subject: "Edison bill", body: "" },
      candidate: { payee_hint: "Edison", amount: 31, due_date: "2026-05-26" },
    });

    expect(result.mapping).toMatchObject({
      status: "invalid_target",
      profileId: "stale",
      behaviorId: "stale-target",
      diagnostics: [{ field: "payee_id", id: "missing-payee", message: "Payee not found" }],
    });
    expect(result.bill).toMatchObject({
      payee: "Edison",
      amount: 31,
      due_date: "2026-05-26",
    });
    expect(result.bill).not.toHaveProperty("payee_id");
  });

  it("lets configured Actual targets override manual extraction output", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 1,
        profiles: [{
          id: "spectrum",
          enabled: true,
          identity: { aliases: ["spectrum"] },
          behaviors: [{
            id: "internet-bill",
            enabled: true,
            type: "expense",
            intent: { body: ["internet statement"] },
            amountStrategy: "model_amount",
            targets: {
              payee_id: "payee-spectrum",
              payee_label: "Spectrum",
              category_id: "cat-internet",
              category_label: "Internet",
            },
          }],
        }],
      },
      metadata,
      source: "extract",
      email: {
        from: "billing@spectrum.net",
        subject: "Your bill",
        body: "Internet statement total due $84.99",
      },
      candidate: {
        payee: "Spectrum Cable LLC",
        amount: 84.99,
        due_date: "2026-05-28",
        type: "expense",
        category_id: "cat-utilities",
      },
    });

    expect(result.mapping).toMatchObject({ status: "matched", amountSource: "model_amount" });
    expect(result.bill).toMatchObject({
      payee: "Spectrum",
      payee_id: "payee-spectrum",
      category_id: "cat-internet",
      amount: 84.99,
      due_date: "2026-05-28",
      type: "expense",
    });
  });
});
