import { describe, expect, it } from "vitest";
import type { ActualMetadata } from "../../shared/types/actual.ts";
import type { BillCandidate, FinancialEmailInput } from "../../shared/types/bills.ts";
import type { FinancialProfile } from "../../shared/types/financial-profiles.ts";
import type { FinancialProviderId } from "../../shared/types/financial-parsers.ts";
import fixtures from "../financial-parsers/fixtures/historical.json" with { type: "json" };
import { assessProviderFinancialEmail } from "../financial-parsers/index.ts";
import { createFinancialEmailPlanner } from "./financial-email-planner.ts";

const profile: FinancialProfile = { id: "card", name: "SoFi", providerId: "sofi", enabled: true,
  budgetId: "budget", senderAddresses: ["sofi@o.sofi.org"], accountLast4: "7849",
  target: { kind: "card_payment", fromAccountId: "savings", toAccountId: "card" } };
const metadata: ActualMetadata = {
  accounts: [{ id: "savings", name: "Savings (0001)", type: "savings" },
    { id: "card", name: "SoFi Credit Card", type: "credit" },
    { id: "other", name: "Other Rewards Card", type: "credit" }],
  payees: [], payeeMap: {}, categories: [], schedules: [], recentTransactions: [],
};

function statement(extra = ""): FinancialEmailInput {
  const source = fixtures.find(entry => entry.name === "sofi")!.source;
  const email = { ...source, body: `${source.body}\n${extra}` };
  const assessment = assessProviderFinancialEmail(email);
  if (assessment.status !== "parsed") throw new Error(`Statement did not parse: ${assessment.reasons.join(",")}`);
  return { source: "financial_event", providerMessageId: "statement", providerId: "sofi", assessmentMode: "deterministic",
    candidate: assessment.candidate, email: { subject: email.subject, body: email.body },
    sourceIdentity: { provider: "gmail", accountId: "mail", senderAddress: "sofi@o.sofi.org", senderAuthentication: "pass" } };
}

function plan(source: FinancialEmailInput, profiles = [profile], actual = metadata) {
  return createFinancialEmailPlanner({
    profileReader: async () => ({ budgetId: "budget", revision: 2, profiles }),
    metadataReader: async () => ({ ...actual, syncHealth: { state: "current", lastSuccessAt: "2026-09-16T00:00:00Z" } }),
    transactionReader: async () => ({ transactions: [] }), occurrenceReader: async () => ({ schedules: [] }),
    now: () => new Date("2026-09-16T00:00:00Z"),
  })("owner", source);
}

describe("card identity authority through the financial planner", () => {
  it.each<FinancialProviderId>(["sofi", "us-bank", "citi", "paypal", "chase"])(
    "allows a unique saved %s card when its statement omits the suffix", async providerId => {
      const source = { ...statement(), providerId };
      const result = await plan(source, [{ ...profile, providerId }]);
      expect(result.profile).toMatchObject({ status: "matched", profileId: "card" });
      expect(result.operation.kind).toBe("create_transfer_schedule");
      expect(result.automation.gates).toContainEqual({ gate: "profile", status: "pass", reasons: [] });
      expect(result.candidate).toMatchObject({ amount: 207.43, due_date: "2026-10-05", from_account_id: "savings", to_account_id: "card" });
    });

  it.each(["disabled", "different-provider", "different-sender", "different-budget", "unbound-provider", "two-cards"])(
    "does not use missing digits to bypass %s", async condition => {
      const configured = { ...profile };
      if (condition === "disabled") configured.enabled = false;
      if (condition === "different-provider") configured.providerId = "chase";
      if (condition === "different-sender") configured.senderAddresses = ["another@example.test"];
      if (condition === "different-budget") configured.budgetId = "old-budget";
      if (condition === "unbound-provider") delete configured.providerId;
      const profiles = condition === "two-cards" ? [configured, { ...configured, id: "other", accountLast4: "1111",
        target: { kind: "card_payment" as const, fromAccountId: "savings", toAccountId: "other" } }] : [configured];
      const result = await plan(statement(), profiles);
      expect(result.profile?.status).toBe(condition === "two-cards" ? "ambiguous" : "missing");
      expect(result.operation.kind).toBe("review");
      expect(result.automation.eligible).toBe(false);
    });

  it("uses explicit matching digits to distinguish two cards", async () => {
    const result = await plan(statement("Credit card ending in 7849."), [profile,
      { ...profile, id: "other", accountLast4: "1111", target: { kind: "card_payment", fromAccountId: "savings", toAccountId: "other" } }]);
    expect(result.profile).toMatchObject({ status: "matched", profileId: "card" });
    expect(result.operation.kind).toBe("create_transfer_schedule");
  });

  it("blocks an explicitly different suffix even when Actual omits digits from the account name", async () => {
    const result = await plan(statement("Credit card ending in 9999."));
    expect(result.profile?.status).toBe("missing");
    expect(result.operation.kind).toBe("review");
  });

  it("checks Actual's card identity when the saved profile has no suffix", async () => {
    const { accountLast4: _suffix, ...withoutSuffix } = profile;
    const actual = { ...metadata, accounts: metadata.accounts.map(account => account.id === "card"
      ? { ...account, name: "SoFi Credit Card (7849)" } : account) };
    const result = await plan(statement("Credit card ending in 9999."), [withoutSuffix], actual);
    expect(result.profile?.status).toBe("invalid");
    expect(result.operation.kind).toBe("review");
  });

  it.each(["unquoted", "low-confidence", "conflicting"])("does not treat %s identity as absent", async condition => {
    const source = statement();
    source.candidate = { ...source.candidate, account_last4: condition === "conflicting" ? null : "7849",
      account_last4_evidence: "Card ending in 7849", account_last4_confidence: condition === "conflicting" ? 0 : condition === "low-confidence" ? 0.5 : 1 };
    const result = await plan(source);
    expect(result.profile?.status).toBe("missing");
    expect(result.automation.eligible).toBe(false);
  });

  it.each(["account", "to_account"] as const)("preserves a conflicting %s product without a suffix", async role => {
    const source = statement("Other Rewards Card");
    source.candidate = { ...source.candidate, [`${role}_hint`]: "Other Rewards Card", [`${role}_hint_confidence`]: 1 };
    const result = await plan(source);
    expect(result.profile?.status).toBe("invalid");
    expect(result.operation.kind).toBe("review");
  });

  it("keeps an authenticated sender requirement after resolving the card", async () => {
    const source = statement();
    source.sourceIdentity = { ...source.sourceIdentity, senderAuthentication: "fail" };
    const result = await plan(source);
    expect(result.profile?.status).toBe("matched");
    expect(result.automation.eligible).toBe(false);
  });

  it("does not use a funding suffix as a card number", async () => {
    const source = statement("Pay from Savings (0001).");
    source.candidate = { ...source.candidate, from_account_hint: "Savings (0001)", from_account_hint_confidence: 1,
      account_hint: "Savings (0001)", account_hint_confidence: 1, account_last4: "0001", account_last4_confidence: 1,
      account_last4_evidence: "Savings (0001)" };
    const result = await plan(source);
    expect(result.operation.kind).toBe("create_transfer_schedule");
    expect(result.candidate?.to_account_id).toBe("card");
  });

  it("does not treat an ungrounded destination as absent alongside valid funding evidence", async () => {
    const source = statement("Pay from Savings (0001).");
    source.candidate = { ...source.candidate, from_account_hint: "Savings (0001)", from_account_hint_confidence: 1,
      account_last4: "0001", account_last4_confidence: 1, account_last4_evidence: "Savings (0001)",
      to_account_hint: "card ending in 9999", to_account_hint_confidence: 1 };
    const result = await plan(source);
    expect(result.profile?.status).toBe("missing");
    expect(result.operation.kind).toBe("review");
  });

  it("preserves suffix requirements for non-card-payment profiles", async () => {
    const source = statement();
    source.candidate = { ...source.candidate, type: "expense", event_kind: "purchase" } as BillCandidate;
    const result = await plan(source, [{ ...profile, target: { kind: "expense", accountId: "card", payeeId: "merchant" } }]);
    expect(result.profile?.status).toBe("missing");
    expect(result.automation.eligible).toBe(false);
  });

  it("keeps conflicting SoFi card numbers in provider review", () => {
    const source = fixtures.find(entry => entry.name === "sofi")!.source;
    expect(assessProviderFinancialEmail({ ...source, body: `${source.body} Credit card ending in 7849. Credit card ending in 9999.` }))
      .toMatchObject({ status: "review", parserVersion: "sofi-v2", reasons: ["provider_account_conflict"] });
  });
});
