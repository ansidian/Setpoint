import { describe, expect, it } from "vitest";
import { resolveBillPayMapping } from "./bill-pay-resolver.ts";

describe("Bill Pay resolver v2 profiles", () => {
  it("uses identity as the whole match when a profile has one enabled behavior", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "sce",
          enabled: true,
          identity: { domain: ["sce.com"] },
          behaviors: [{
            id: "monthly-bill",
            enabled: true,
            type: "bill",
            targets: {
              payee_id: "payee-edison",
              payee_label: "Southern California Edison",
            },
          }],
        }],
      },
      metadata: {
        payees: [{ id: "payee-edison", name: "Southern California Edison" }],
      },
      source: "triage",
      email: { from: "billing@sce.com", subject: "Your monthly bill", body: "Total due $100.00" },
      candidate: {
        payee_hint: "SCE",
        event_kind: "bill_issued",
        amount: 100,
        amount_kind: "total_due",
        amount_candidates: [{ kind: "total_due", value: 100 }],
        due_date: "2026-05-20",
      },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "sce",
      behaviorId: "monthly-bill",
      amountSource: "semantic:total_due",
    });
  });

  it("never resolves minimum due as the operational amount", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "card",
          identity: { domain: ["example.test"] },
          behaviors: [{ id: "statement", type: "transfer", targets: { to_account_id: "card" } }],
        }],
      },
      email: { from: "billing@example.test" },
      candidate: {
        event_kind: "statement_issued",
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40 }],
      },
    });

    expect(result.mapping).toMatchObject({
      status: "identity_only",
      reason: "semantic_amount_missing",
    });
  });

  it("resolves statement balance as canonical over another selected amount", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "card",
          identity: { domain: ["example.test"] },
          behaviors: [{ id: "statement", type: "transfer", targets: { to_account_id: "card" } }],
        }],
      },
      email: { from: "billing@example.test" },
      candidate: {
        event_kind: "statement_issued",
        amount: 40,
        amount_kind: "payment_amount",
        amount_candidates: [
          { kind: "payment_amount", value: 40, confidence: 0.99 },
          { kind: "statement_balance", value: 391.2, confidence: 0.9 },
        ],
      },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      amountSource: "semantic:statement_balance",
    });
    expect(result.bill).toMatchObject({ amount: 391.2, amount_kind: "statement_balance" });
  });

  it.each([
    ["statement_issued", "transfer", "statement_balance"],
    ["payment_due", "transfer", "statement_balance"],
    ["payment_scheduled", "transfer", "payment_amount"],
    ["card_payment_completed", "transfer", "payment_amount"],
    ["payment_completed", "expense", "payment_amount"],
    ["purchase", "expense", "transaction_amount"],
    ["refund", "income", "refund_amount"],
    ["bill_issued", "bill", "total_due"],
    ["reward", "income", "refund_amount"],
  ] as const)("routes %s without reading behavior intent text", (eventKind, type, amountKind) => {
    const amount = 42.5;
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "profile",
          identity: { domain: ["example.test"] },
          behaviors: [{
            id: `behavior-${eventKind}`,
            type,
            targets: type === "transfer"
              ? { to_account_id: "card" }
              : { payee_id: "payee" },
          }],
        }],
      },
      email: { from: "billing@example.test", subject: "Unrelated wording" },
      candidate: {
        event_kind: eventKind,
        type,
        amount,
        amount_kind: amountKind,
        amount_candidates: [{ kind: amountKind, value: amount }],
      },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      behaviorId: `behavior-${eventKind}`,
      amountSource: `semantic:${amountKind}`,
    });
    expect(result.bill).toMatchObject({ type, amount });
  });

  it("collapses equivalent event-compatible behaviors with the same target policy", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "card",
          identity: { domain: ["example.test"] },
          behaviors: [
            {
              id: "purchase",
              type: "expense",
              targets: { account_id: "card", payee_id: "merchant" },
            },
            {
              id: "authorized-payment",
              type: "expense",
              targets: { payee_id: "merchant", account_id: "card" },
            },
          ],
        }],
      },
      email: { from: "alerts@example.test", subject: "Unmatched copy" },
      candidate: {
        event_kind: "purchase",
        amount: 18,
        amount_kind: "transaction_amount",
        amount_candidates: [{ kind: "transaction_amount", value: 18 }],
      },
    });

    expect(result.mapping).toMatchObject({ status: "matched", behaviorId: "purchase" });
    expect(result.bill).toMatchObject({ account_id: "card", payee_id: "merchant", amount: 18 });
  });

  it("refuses to guess when an event maps to different target policies", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "card",
          identity: { domain: ["example.test"] },
          behaviors: [
            { id: "fuel", type: "expense", targets: { category_id: "fuel" } },
            { id: "groceries", type: "expense", targets: { category_id: "groceries" } },
          ],
        }],
      },
      email: { from: "alerts@example.test" },
      candidate: { event_kind: "purchase", amount: 20 },
    });

    expect(result.mapping).toEqual({
      status: "identity_only",
      profileId: "card",
      reason: "semantic_event_ambiguous_targets",
      matchedProfiles: ["card"],
    });
  });

  it("uses the extracted bill type only when it safely narrows an event family", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "card",
          identity: { domain: ["example.test"] },
          behaviors: [
            { id: "card-payment", type: "transfer", targets: { to_account_id: "card" } },
            { id: "merchant-payment", type: "expense", targets: { account_id: "card" } },
          ],
        }],
      },
      email: { from: "alerts@example.test" },
      candidate: {
        event_kind: "card_payment_completed",
        type: "transfer",
        amount: 45,
        amount_kind: "payment_amount",
        amount_candidates: [{ kind: "payment_amount", value: 45 }],
      },
    });

    expect(result.mapping).toMatchObject({ status: "matched", behaviorId: "card-payment" });
    expect(result.bill).toMatchObject({ type: "transfer", to_account_id: "card", amount: 45 });
  });

  it("does not fall back to text intent matching when semantic event evidence is missing", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "card",
          identity: { domain: ["example.test"] },
          behaviors: [{
            id: "purchase",
            type: "expense",
            targets: { account_id: "card" },
          }],
        }],
      },
      email: { from: "alerts@example.test", subject: "Purchase" },
      candidate: { amount: 20 },
    });

    expect(result.mapping).toEqual({
      status: "identity_only",
      profileId: "card",
      reason: "semantic_event_missing",
      matchedProfiles: ["card"],
    });
  });

  it.each([
    ["exact sender", { sender: ["billing@example.test"] }, { from: "Billing Team <billing@example.test>" }, true],
    ["different sender", { sender: ["billing@example.test"] }, { from: "billing+other@example.test" }, false],
    ["exact domain", { domain: ["example.test"] }, { from: "billing@example.test" }, true],
    ["true subdomain", { domain: ["example.test"] }, { from: "billing@alerts.example.test" }, true],
    ["false suffix domain", { domain: ["example.test"] }, { from: "billing@evilexample.test" }, false],
    ["sender display alias", { aliases: ["Example Billing"] }, { from: "Example Billing <billing@unrelated.test>" }, true],
    ["body-only alias", { aliases: ["Example Billing"] }, { from: "Other <billing@unrelated.test>", body: "Example Billing" }, false],
  ] as const)("enforces deterministic %s identity", (_label, identity, email, matched) => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "profile",
          identity,
          behaviors: [{ id: "bill", type: "bill", targets: { payee_id: "payee" } }],
        }],
      },
      email,
      candidate: {
        event_kind: "bill_issued",
        amount: 42,
        amount_kind: "total_due",
        amount_candidates: [{ kind: "total_due", value: 42 }],
      },
    });

    expect(result.mapping.status === "matched").toBe(matched);
  });

  it("uses account last-four only with exact, confident semantic evidence", () => {
    const resolve = (candidate: Record<string, unknown>) => resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: [{
          id: "card",
          identity: { last4: ["1234"] },
          behaviors: [{ id: "statement", type: "transfer", targets: { to_account_id: "card" } }],
        }],
      },
      email: { from: "alerts@bank.test", body: "Account ending 1234" },
      candidate: {
        event_kind: "statement_issued",
        amount: 42,
        amount_kind: "statement_balance",
        amount_candidates: [{ kind: "statement_balance", value: 42 }],
        ...candidate,
      },
    });

    expect(resolve({ account_last4: "1234", account_last4_evidence: "Account ending 1234", account_last4_confidence: 0.99 }).mapping.status).toBe("matched");
    expect(resolve({ account_last4: "1234", account_last4_evidence: "Account ending 9999", account_last4_confidence: 0.99 }).mapping.status).toBe("unmapped");
    expect(resolve({ account_last4: "1234", account_last4_evidence: "Account ending 1234", account_last4_confidence: 0.5 }).mapping.status).toBe("unmapped");
    expect(resolve({}).mapping.status).toBe("unmapped");
  });

  it("fails closed when more than one enabled profile matches", () => {
    const result = resolveBillPayMapping({
      mappings: {
        version: 2,
        profiles: ["first", "second"].map((id) => ({
          id,
          identity: { domain: ["example.test"] },
          behaviors: [{ id: "bill", type: "bill", targets: { payee_id: id } }],
        })),
      },
      email: { from: "billing@example.test" },
      candidate: { event_kind: "bill_issued" },
    });

    expect(result.mapping).toEqual({
      status: "identity_only",
      reason: "semantic_identity_ambiguous_profiles",
      matchedProfiles: ["first", "second"],
    });
  });
});
