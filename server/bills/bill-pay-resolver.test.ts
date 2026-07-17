import { describe, expect, it } from "vitest";
import { resolveBillPayMapping } from "./bill-pay-resolver.ts";

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

  it("extracts statement balances and due dates from bank payment reminders", () => {
    const mappings = {
      version: 1,
      profiles: [
        {
          id: "sofi",
          enabled: true,
          identity: { domain: ["o.sofi.org"], aliases: ["SoFi Credit Card"] },
          behaviors: [{
            id: "payment-due",
            enabled: true,
            type: "transfer",
            intent: { subject: ["payment is due"], body: ["remaining statement balance"] },
            amountStrategy: "statement_balance",
            targets: {
              from_account_id: "acct-checking",
              from_account_label: "Checking",
              to_account_id: "acct-card",
              to_account_label: "Visa 4242",
            },
          }],
        },
        {
          id: "usbank",
          enabled: true,
          identity: { domain: ["notifications.usbank.com"], last4: ["8288"] },
          behaviors: [{
            id: "payment-due",
            enabled: true,
            type: "transfer",
            intent: { subject: ["payment is due"], body: ["credit card ending in 8288"] },
            amountStrategy: "statement_balance",
            targets: {
              from_account_id: "acct-checking",
              from_account_label: "Checking",
              to_account_id: "acct-card",
              to_account_label: "Visa 4242",
            },
          }],
        },
      ],
    };

    const sofi = resolveBillPayMapping({
      mappings,
      metadata,
      source: "pasted_text",
      email: {
        from: "SoFi@o.sofi.org",
        subject: "Your SoFi Credit Card payment is due on May 05, 2026",
        body: "This is a reminder that you have a SoFi Credit Card payment due on Tuesday, May 05, 2026. The remaining statement balance is: $156.98.",
      },
    });
    const usbank = resolveBillPayMapping({
      mappings,
      metadata,
      source: "pasted_text",
      email: {
        from: "usbank@notifications.usbank.com",
        subject: "Your credit card payment is due on May 10, 2026.",
        body: "Your automatic payment to your credit card ending in 8288. Minimum payment due $40.00 Statement balance $253.10.",
      },
    });

    expect(sofi.mapping).toMatchObject({ status: "matched", profileId: "sofi", amountSource: "statement_balance" });
    expect(sofi.bill).toMatchObject({ amount: 156.98, due_date: "2026-05-05" });
    expect(usbank.mapping).toMatchObject({ status: "matched", profileId: "usbank", amountSource: "statement_balance" });
    expect(usbank.bill).toMatchObject({ amount: 253.1, due_date: "2026-05-10" });
  });

  it("extracts U.S. Bank remaining statement balance from flattened table text", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 1,
        profiles: [{
          id: "usbank",
          enabled: true,
          identity: { domain: ["notifications.usbank.com"], aliases: ["US Bank"], last4: ["8288"] },
          behaviors: [{
            id: "payment-due",
            enabled: true,
            type: "transfer",
            intent: { subject: ["payment is due"], body: ["credit card ending in 8288"] },
            amountStrategy: "statement_balance",
            targets: {
              from_account_id: "acct-checking",
              from_account_label: "Checking",
              to_account_id: "acct-card",
              to_account_label: "Visa 4242",
            },
          }],
        }],
      },
      metadata,
      source: "pasted_text",
      email: {
        from: "usbank@notifications.usbank.com",
        subject: "Your credit card payment is due on May 10, 2026.",
        body: [
          "US Bank",
          "Your credit card payment is due on May 10, 2026.",
          "Your automatic payment to your credit card ending in 8288 will be made on May 10, 2026.",
          "Due date *May 10, 2026*",
          "Minimum payment Avoid late fees *$40.00*",
          "Plan adjusted balance Avoid interest and late fees on your ExtendPay plan",
          "Remaining statement balance Avoid interest and late fees",
          "*$0.00*",
          "*$253.10*",
        ].join(" "),
      },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "usbank",
      behaviorId: "payment-due",
      amountSource: "statement_balance",
    });
    expect(result.bill).toMatchObject({ amount: 253.1, due_date: "2026-05-10" });
  });

  it("extracts payment amounts and dates from autopay and confirmation wording", () => {
    const mappings = {
      version: 1,
      profiles: [{
        id: "paypal",
        enabled: true,
        identity: { aliases: ["PayPal Cashback World Mastercard"] },
        behaviors: [{
          id: "payment",
          enabled: true,
          type: "transfer",
          intent: { body: ["PayPal Cashback World Mastercard"] },
          amountStrategy: "amount_due",
          targets: {
            from_account_id: "acct-checking",
            from_account_label: "Checking",
            to_account_id: "acct-card",
            to_account_label: "Visa 4242",
          },
        }],
      }],
    };

    const cases = [
      [
        "autopay",
        "Monthly autopay option Statement Balance Payment date 05/07/2026 Payment Amount $162.00 PayPal Cashback World Mastercard",
        162,
        "2026-05-07",
      ],
      [
        "amount-paid",
        "Hello, Andy You paid $50.61. Amount Paid $50.61 Paid On 04/07/2026 PayPal Cashback World Mastercard Account Ending In 3234",
        50.61,
        "2026-04-07",
      ],
      [
        "payment-of",
        "Your payment of $317.81 is complete. Thanks for your payment of $317.81 to your PayPal Cashback World Mastercard.",
        317.81,
        null,
      ],
    ];

    for (const [name, body, amount, dueDate] of cases) {
      const result = resolveBillPayMapping({
        mappings,
        metadata,
        source: "pasted_text",
        email: {
          from: "customer.service@servicing.synchrony.com",
          subject: "Payment Confirmation",
          body,
        },
      });

      expect(result.mapping, String(name)).toMatchObject({
        status: "matched",
        profileId: "paypal",
        behaviorId: "payment",
        amountSource: "amount_due",
      });
      expect(result.bill, String(name)).toMatchObject({ amount, due_date: dueDate });
    }
  });

  it("extracts minimum payment due wording from card statements", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 1,
        profiles: [{
          id: "chase",
          enabled: true,
          identity: { domain: ["chase.com"], last4: ["8635"] },
          behaviors: [{
            id: "minimum",
            enabled: true,
            type: "transfer",
            intent: { subject: ["statement"], body: ["minimum payment due"] },
            amountStrategy: "minimum_due",
            targets: {
              from_account_id: "acct-checking",
              from_account_label: "Checking",
              to_account_id: "acct-card",
              to_account_label: "Visa 4242",
            },
          }],
        }],
      },
      metadata,
      source: "pasted_text",
      email: {
        from: "no.reply.alerts@chase.com",
        subject: "Your credit card statement is available",
        body: "Account Chase Credit Card (...8635) Due date 03/28/2026 Minimum payment due $40.00 Statement balance $54.41 Auto-pay enabled",
      },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "chase",
      behaviorId: "minimum",
      amountSource: "minimum_due",
    });
    expect(result.bill).toMatchObject({ amount: 40, due_date: "2026-03-28" });
  });

  it("parses plain transaction amount and labeled date from pasted text", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 1,
        profiles: [{
          id: "citi",
          enabled: true,
          identity: {
            domain: ["citi.com"],
            last4: ["7268"],
          },
          behaviors: [{
            id: "transaction-gas",
            enabled: true,
            type: "expense",
            intent: {
              subject: ["transaction"],
              body: ["gas"],
            },
            amountStrategy: "amount_due",
            targets: {
              account_id: "acct-card",
              account_label: "Visa 4242",
              category_id: "cat-utilities",
              category_label: "Utilities",
            },
          }],
        }],
      },
      metadata,
      source: "pasted_text",
      email: {
        from: "alerts@info6.citi.com",
        subject: "A $44.72 transaction was made on your Costco Anywhere",
        body: [
          "Amount: $44.72",
          "Card Ending In",
          "7268",
          "Merchant",
          "COSTCO GAS #1318 MONTEREY PARKUS",
          "Date",
          "04/30/2026",
        ].join("\n"),
      },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "citi",
      behaviorId: "transaction-gas",
      amountSource: "amount_due",
    });
    expect(result.bill).toMatchObject({
      type: "expense",
      amount: 44.72,
      due_date: "2026-04-30",
      account_id: "acct-card",
      category_id: "cat-utilities",
    });
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
