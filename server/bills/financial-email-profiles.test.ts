import { describe, expect, it } from "vitest";
import { createFinancialEmailPlanner } from "./financial-email-planner.ts";
import { createBillCandidateVerificationService } from "./bill-candidate-verification-service.ts";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import type { BillCandidate, FinancialEmailInput } from "../../shared/types/bills.ts";
import type { FinancialProfile, FinancialProfileConfiguration } from "../../shared/types/financial-profiles.ts";

const metadata: ActualMetadata = {
  accounts: [{ id: "savings", name: "Savings (0001)", type: "savings" }, { id: "card", name: "Rewards Card (3234)", type: "credit" }],
  payees: [{ id: "power", name: "Power Company" }, { id: "merchant", name: "Example Shop" }],
  payeeMap: { power: "Power Company", merchant: "Example Shop" },
  categories: [{ name: "Home", categories: [{ id: "electricity", name: "Electricity" }] }],
  schedules: [{ id: "electric", name: "Electricity", type: "bill", next_date: "2026-09-21", conditions: [
    { field: "account", op: "is", value: "savings" }, { field: "payee", op: "is", value: "power" },
    { field: "category", op: "is", value: "electricity" }, { field: "amount", op: "is", value: -5000 },
  ] }], recentTransactions: [],
};
const utility: FinancialProfile = { id: "electricity", name: "Electricity", enabled: true, budgetId: "budget",
  senderAddresses: ["bills@power.example"], target: { kind: "utility", scheduleId: "electric" } };
const expense: FinancialProfile = { id: "shop", name: "Example Shop", enabled: true, budgetId: "budget",
  senderAddresses: ["bills@power.example"], target: { kind: "expense", accountId: "card", payeeId: "merchant" } };
const bill: BillCandidate = { type: "bill", type_confidence: 0.99, type_evidence: "Your new utility bill",
  event_kind: "bill_issued", event_confidence: 0.99, event_evidence: "Your new utility bill",
  payee: "Provider billing", payee_hint: "Provider billing", document_role: "statement", currency: "USD",
  amount: 97.2, amount_kind: "total_due", due_date: "2026-09-21",
  amount_candidates: [{ kind: "total_due", value: 97.2, confidence: 0.99, evidence: "Total $97.20" }] };
const purchase: BillCandidate = { ...bill, type: "expense", type_evidence: "Purchase from Example Shop",
  event_kind: "purchase", event_evidence: "Purchase from Example Shop", document_role: "merchant_receipt",
  payee: "Example Shop", payee_hint: "Example Shop", account_hint: "Rewards Card", account_hint_confidence: 0.99,
  amount_kind: "transaction_amount", amount_candidates: [{ kind: "transaction_amount", value: 97.2, confidence: 0.99, evidence: "Total $97.20" }] };

function planner(profiles: FinancialProfile[] = [], overrides: Partial<ActualMetadata> = {}) {
  const config: FinancialProfileConfiguration = { budgetId: "budget", revision: 2, profiles };
  return createFinancialEmailPlanner({
    profileReader: async () => config,
    metadataReader: async () => ({ ...metadata, ...overrides, syncHealth: { state: "current", lastSuccessAt: "2026-09-09T12:00:00Z" } }),
    occurrenceReader: async () => ({ schedules: [] }), transactionReader: async () => ({ transactions: [] }),
    candidateVerification: createBillCandidateVerificationService({ credentialResolver: async () => null,
      providers: { openai: { extract: async () => { throw new Error("No additional provider facts in this fixture"); } } } }),
    modelChoiceReader: async () => ({ provider: "openai", model: "fixture" }),
    now: () => new Date("2026-09-09T12:00:00Z"),
  });
}
function input(candidate: BillCandidate): FinancialEmailInput {
  return { source: "financial_event", providerMessageId: "event-1", candidate,
    sourceIdentity: { provider: "gmail", accountId: "mail", senderAddress: "bills@power.example", senderAuthentication: "pass" },
    email: { from: "bills@power.example", subject: "Financial document",
      body: "Your new utility bill. Purchase from Example Shop. Total $97.20 due September 21, 2026. Payment method: Rewards Card." } };
}

const chaseCards = [
  { id: "freedom", name: "Chase Freedom", last4: "8635" },
  { id: "prime", name: "Chase Prime", last4: "5808" },
];
const chaseProfiles: FinancialProfile[] = chaseCards.map(card => ({
  id: card.id, name: `${card.name} cashback`, enabled: true, budgetId: "budget",
  senderAddresses: ["rewards@chase.example"], accountLast4: card.last4,
  target: { kind: "income", accountId: card.id, payeeId: "merchant" },
}));
const chaseMetadata = { accounts: chaseCards.map(card => ({ id: card.id, name: card.name, type: "credit" })) };

function chaseCashback(last4: string, role: "account" | "to_account" = "account"): FinancialEmailInput {
  const hint = `card ending in ${last4}`;
  return { source: "financial_event", providerMessageId: `chase-${last4}`,
    sourceIdentity: { provider: "gmail", accountId: "mail", senderAddress: "rewards@chase.example", senderAuthentication: "pass" },
    email: { body: `Cashback redemption completed for $97.20 on September 4, 2026 to your ${hint} as a statement credit. Redemption ID: reward-${last4}.` },
    candidate: { type: "income", type_confidence: 0.99, type_evidence: "Cashback redemption completed",
      event_kind: "reward", event_confidence: 0.99, event_evidence: "Cashback redemption completed",
      payee: "Chase", amount: 97.2, amount_kind: "transaction_amount", currency: "USD", due_date: "2026-09-04",
      amount_candidates: [{ kind: "transaction_amount", value: 97.2, confidence: 0.99, evidence: "$97.20" }],
      settlement_kind: "statement_credit", settlement_confidence: 0.99, settlement_evidence: "statement credit",
      provider_reference: `reward-${last4}`, provider_reference_confidence: 0.99, provider_reference_evidence: `Redemption ID: reward-${last4}`,
      account_last4: last4, account_last4_confidence: 0.99, account_last4_evidence: hint,
      [`${role}_hint`]: hint, [`${role}_hint_confidence`]: 0.99 } };
}

describe("profile-backed financial planning", () => {
  it("uses the utility's exact schedule and category instead of rediscovering its provider label", async () => {
    const plan = await planner([utility])( "owner", input(bill));
    expect(plan.profile).toMatchObject({ status: "matched", profileId: "electricity", revision: 2, budgetId: "budget" });
    expect(plan.targets.schedule).toMatchObject({ status: "resolved", id: "electric" });
    expect(plan.candidate).toMatchObject({ account_id: "savings", payee_id: "power", category_id: "electricity", amount: 97.2, due_date: "2026-09-21" });
    expect(plan.automation.gates).toContainEqual({ gate: "profile", status: "pass", reasons: [] });
  });

  it("keeps inferred receipt suggestions review-only when no profile matches", async () => {
    const plan = await planner()( "owner", input(purchase));
    expect(plan.targets.account).toMatchObject({ status: "resolved", id: "card" });
    expect(plan.targets.payee).toMatchObject({ status: "resolved", id: "merchant" });
    expect(plan.operation.kind).toBe("review");
    expect(plan.automation.eligible).toBe(false);
    expect(plan.reviewReasons).toContainEqual(expect.objectContaining({ code: "profile_required" }));
    expect(plan.profileSuggestion).toMatchObject({ budgetId: "budget",
      senderAddresses: ["bills@power.example"], merchantName: "Example Shop",
      target: { kind: "expense", accountId: "card", payeeId: "merchant" } });
  });

  it.each(["unresolved-account", "new-payee", "missing-sender"])("does not offer reusable authority for %s", async missing => {
    const source = input(purchase);
    if (missing === "missing-sender") source.sourceIdentity = { ...source.sourceIdentity, senderAddress: null };
    const plan = await planner([], missing === "unresolved-account" ? { accounts: [] }
      : missing === "new-payee" ? { payees: [], payeeMap: {} } : {})("owner", source);
    expect(plan.profileSuggestion).toBeUndefined();
    expect(plan.automation.eligible).toBe(false);
  });

  it("does not replace an explicit different account with a saved default", async () => {
    const configured = { ...expense, target: { ...expense.target, kind: "expense" as const, accountId: "savings", payeeId: "merchant" } };
    const plan = await planner([configured])( "owner", input(purchase));
    expect(plan.profile?.status).toBe("invalid");
    expect(plan.operation.kind).toBe("review");
    expect(plan.reviewReasons).toContainEqual(expect.objectContaining({ code: "profile_conflict" }));
  });

  it("does not replace an explicitly different funding suffix even when that account is absent from Actual", async () => {
    const configured: FinancialProfile = { ...utility, target: { kind: "card_payment", fromAccountId: "savings", toAccountId: "card" } };
    const candidate: BillCandidate = { ...bill, type: "transfer", type_evidence: "Card payment scheduled", event_kind: "payment_scheduled",
      event_evidence: "Card payment scheduled", amount_kind: "payment_amount", amount_candidates: [{ kind: "payment_amount", value: 97.2, confidence: 0.99, evidence: "$97.20" }],
      from_account_hint: "Other Checking (2222)", from_account_hint_confidence: 0.99 };
    const source = input(candidate);
    source.email = { body: "Card payment scheduled for $97.20 on September 21, 2026 from Other Checking (2222)." };
    const plan = await planner([configured])("owner", source);
    expect(plan.profile?.status).toBe("invalid");
    expect(plan.operation.kind).toBe("review");
    expect(plan.automation.eligible).toBe(false);
  });

  it("keeps a scheduled payment's Savings suffix separate from its card destination", async () => {
    const configured: FinancialProfile = { ...utility, target: { kind: "card_payment", fromAccountId: "savings", toAccountId: "card" } };
    const candidate: BillCandidate = { ...bill, type: "transfer", type_evidence: "Card payment scheduled", event_kind: "payment_scheduled",
      event_evidence: "Card payment scheduled", amount_kind: "payment_amount",
      amount_candidates: [{ kind: "payment_amount", value: 97.2, confidence: 0.99, evidence: "$97.20" }],
      from_account_hint: "Savings (0001)", from_account_hint_confidence: 0.99,
      account_hint: "Savings (0001)", account_hint_confidence: 0.99,
      account_last4: "0001", account_last4_evidence: "Savings (0001)", account_last4_confidence: 0.99 };
    const source = input(candidate);
    source.email = { body: "Card payment scheduled for $97.20 on September 21, 2026 from Savings (0001) to Rewards Card (3234)." };
    const plan = await planner([configured])("owner", source);
    expect(plan.profile?.status).toBe("matched");
    expect(plan.targets.fromAccount).toMatchObject({ status: "resolved", id: "savings" });
    expect(plan.targets.toAccount).toMatchObject({ status: "resolved", id: "card" });
    expect(plan.reviewReasons).not.toContainEqual(expect.objectContaining({ code: "profile_conflict" }));
  });

  it.each(["Other Card (4444)", "Amazon gift-card balance"])("preserves an income destination conflict for %s", async destination => {
    const configured: FinancialProfile = { ...utility, target: { kind: "income", accountId: "card", payeeId: "merchant" } };
    const candidate: BillCandidate = { ...bill, type: "income", type_evidence: "Refund issued", event_kind: "refund",
      event_evidence: "Refund issued", amount_kind: "refund_amount",
      amount_candidates: [{ kind: "refund_amount", value: 97.2, confidence: 0.99, evidence: "$97.20" }],
      to_account_hint: destination, to_account_hint_confidence: 0.99 };
    const source = input(candidate);
    source.email = { body: `Refund issued for $97.20 on September 21, 2026 to ${destination}.` };
    const plan = await planner([configured])("owner", source);
    expect(plan.profile?.status).toBe("invalid");
    expect(plan.operation.kind).toBe("review");
    expect(plan.automation.eligible).toBe(false);
  });

  it("does not replace a named untracked income account even without a suffix", async () => {
    const configured: FinancialProfile = { ...utility, target: { kind: "income", accountId: "card", payeeId: "merchant" } };
    const candidate: BillCandidate = { ...bill, type: "income", type_evidence: "Refund issued", event_kind: "refund",
      event_evidence: "Refund issued", amount_kind: "refund_amount",
      amount_candidates: [{ kind: "refund_amount", value: 97.2, confidence: 0.99, evidence: "$97.20" }],
      account_hint: "Amazon gift-card balance", account_hint_confidence: 0.99 };
    const source = input(candidate);
    source.email = { body: "Refund issued for $97.20 on September 21, 2026 to Amazon gift-card balance." };
    const plan = await planner([configured])("owner", source);
    expect(plan.profile?.status).toBe("invalid");
    expect(plan.operation.kind).toBe("review");
  });

  it.each(chaseCards)("resolves $name from the saved last-four mapping without its name in the email or suffix in Actual", async card => {
    for (const role of ["account", "to_account"] as const) {
      const plan = await planner(chaseProfiles, chaseMetadata)("owner", chaseCashback(card.last4, role));
      expect(plan.profile).toMatchObject({ status: "matched", profileId: card.id });
      expect(plan.targets.account).toMatchObject({ status: "resolved", id: card.id, label: card.name });
      expect(plan.candidate).toMatchObject({ account_id: card.id, amount: 97.2 });
      expect(plan.operation.kind).toBe("create_transaction");
    }
  });

  it.each(chaseCards)("routes a confirmed payment to $name through its saved last-four mapping", async card => {
    const profiles: FinancialProfile[] = chaseProfiles.map(profile => ({ ...profile,
      target: { kind: "card_payment", fromAccountId: "savings", toAccountId: profile.id } }));
    const source = chaseCashback(card.last4);
    source.email!.body = `Card payment scheduled for $97.20 on September 21, 2026 from Savings (0001) to card ending in ${card.last4}.`;
    source.candidate = { ...source.candidate, type: "transfer", type_evidence: "Card payment scheduled",
      event_kind: "payment_scheduled", event_evidence: "Card payment scheduled", amount_kind: "payment_amount", due_date: "2026-09-21",
      amount_candidates: [{ kind: "payment_amount", value: 97.2, confidence: 0.99, evidence: "$97.20" }],
      from_account_hint: "Savings (0001)", from_account_hint_confidence: 0.99,
      settlement_kind: null, settlement_confidence: null, settlement_evidence: null,
      provider_reference: null, provider_reference_confidence: null, provider_reference_evidence: null };
    const plan = await planner(profiles, { accounts: [metadata.accounts[0]!, ...chaseMetadata.accounts] })("owner", source);
    expect(plan.profile).toMatchObject({ status: "matched", profileId: card.id });
    expect(plan.targets.fromAccount).toMatchObject({ status: "resolved", id: "savings" });
    expect(plan.targets.toAccount).toMatchObject({ status: "resolved", id: card.id, label: card.name });
    expect(plan.operation.kind).toBe("create_transfer_schedule");
  });

  it.each(["card ending in 5808", "Amazon gift-card balance (8635)"])(
    "does not let a saved suffix override conflicting income destination %s", async destination => {
      const source = chaseCashback("8635");
      source.candidate!.to_account_hint = destination;
      source.candidate!.to_account_hint_confidence = 0.99;
      source.email!.body += ` Destination: ${destination}.`;
      const plan = await planner(chaseProfiles, chaseMetadata)("owner", source);
      expect(plan.profile?.status).toBe("invalid");
      expect(plan.operation.kind).toBe("review");
    },
  );

  it.each(["unknown-suffix", "ungrounded-suffix"])("requires review for %s instead of selecting a Chase card", async condition => {
    const source = chaseCashback(condition === "unknown-suffix" ? "9999" : "8635");
    if (condition === "ungrounded-suffix") source.candidate!.account_last4_evidence = "A different account ending in 8635";
    const plan = await planner(chaseProfiles, chaseMetadata)("owner", source);
    expect(plan.profile?.status).not.toBe("matched");
    expect(plan.operation.kind).toBe("review");
  });

  it.each(["disabled", "ambiguous", "other-budget", "missing-target"])("requires review for %s profiles", async condition => {
    const profiles = condition === "ambiguous" ? [expense, { ...expense, id: "other" }]
      : [{ ...expense, enabled: condition !== "disabled", budgetId: condition === "other-budget" ? "old-budget" : "budget" }];
    const plan = await planner(profiles, condition === "missing-target" ? { accounts: [] } : {})( "owner", input(purchase));
    expect(plan.profile?.status).not.toBe("matched");
    expect(plan.operation.kind).toBe("review");
    expect(plan.automation.eligible).toBe(false);
  });

});
