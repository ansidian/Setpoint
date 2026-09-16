import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/historical.json" with { type: "json" };
import { assessProviderFinancialEmail, identifyFinancialProvider } from "./index.ts";
import { FINANCIAL_PROVIDER_CATALOG, type FinancialProviderEmailSource } from "../../shared/types/financial-parsers.ts";

function fixture(name: string): FinancialProviderEmailSource {
  const entry = fixtures.find(f => f.name === name);
  if (!entry) throw new Error(`Missing historical fixture: ${name}`);
  return entry.source;
}

// Labeled directly from source statement/receipt rows, not from parser output.
const historicalFacts = [
  ["sce", "sce", 301.11, "2026-09-14", "total_due", "bill_issued"],
  ["sce-earlier", "sce", 144.11, "2026-06-16", "total_due", "bill_issued"],
  ["socalgas", "socalgas", 47.26, "2026-08-11", "total_due", "bill_issued"],
  ["sgv-water", "sgv-water", 67.97, "2026-09-28", "total_due", "bill_issued"],
  ["sgv-water-earlier", "sgv-water", 65.82, "2026-06-28", "total_due", "bill_issued"],
  ["spectrum", "spectrum", 110, "2026-08-01", "total_due", "bill_issued"],
  ["sofi", "sofi", 207.43, "2026-10-05", "statement_balance", "statement_issued"],
  ["chase", "chase", 306.8, "2026-10-09", "statement_balance", "statement_issued"],
  ["chase-earlier", "chase", 181.44, "2026-06-28", "statement_balance", "statement_issued"],
  ["citi", "citi", 240.88, "2026-06-10", "statement_balance", "statement_issued"],
  ["citi-purchase", "citi", 48.52, "2026-09-11", "transaction_amount", "purchase"],
  ["paypal-statement", "paypal", 121.3, "2026-10-07", "statement_balance", "statement_issued"],
  ["paypal-autopay", "paypal", 74.49, "2026-09-07", "payment_amount", "payment_scheduled"],
  ["paypal-refund", "paypal", 17.99, "2026-08-22", "refund_amount", "refund"],
  ["paypal-merchant", "paypal", 0.99, "2026-08-18", "transaction_amount", "purchase"],
  ["paypal-receipt-columns", "paypal", 30, "2026-09-06", "transaction_amount", "purchase"],
  ["paypal-receipt-inline", "paypal", 90, "2026-06-06", "transaction_amount", "purchase"],
  ["paypal-merchant-refund", "paypal", 39.99, "2026-02-27", "refund_amount", "refund"],
  ["us-bank", "us-bank", 501.47, "2026-10-10", "statement_balance", "statement_issued"],
  ["valley-vista", "valley-vista", 119.01, "2026-08-07", "total_due", "bill_issued"],
] as const;

describe("provider financial assessment", () => {
  it.each(historicalFacts)("extracts the labeled facts from %s", (name, providerId, amount, due_date, amount_kind, event_kind) => {
    const r = assessProviderFinancialEmail(fixture(name));
    expect(r).toMatchObject({ status: "parsed", providerId, reasons: [], candidate: { amount, due_date, amount_kind, event_kind, currency: "USD" } });
    if (r.status !== "parsed") throw new Error("Expected parsed fixture");
    expect(r.candidate.amount_candidates?.find(a => a.kind === amount_kind)?.evidence).toBeTruthy();
    expect(r.parserVersion).toBe(providerId === "sofi" ? "sofi-v2" : `${providerId}-v1`);
    expect(r.policyVersion).toContain("provider-text-v1:registry-v1:");
    expect(r.policyVersion).toContain(r.parserVersion);
  });

  it("recognizes every registered company and requires SGV identity for shared InvoiceCloud mail", () => {
    for (const provider of FINANCIAL_PROVIDER_CATALOG) {
      expect(identifyFinancialProvider(provider.senderAddresses[0], { subject: "San Gabriel Valley Water Company" })).toBe(provider.id);
    }
    expect(identifyFinancialProvider("no-reply@invoicecloud.net", { subject: "Unrelated City Water Invoice" })).toBeNull();
    expect(identifyFinancialProvider("attacker@example.test", { subject: "San Gabriel Valley Water Company" })).toBeNull();
    expect(identifyFinancialProvider("Citi <Citicards@info6.citi.com>")).toBe("citi");
  });

  it.each([
    ["sofi-conflicting-autopay", "provider_event_conflict"],
    ["us-bank-lossy", "provider_amount_missing"],
    ["amazon-multiple-orders", "provider_order_reference_missing_or_ambiguous"],
    ["paypal-authorization", "provider_payment_authorization_pending"],
    ["paypal-transfer", "provider_transfer_pending"],
    ["chase-reward", "provider_reward_pending"],
  ])("retains trustworthy partial facts for %s without declaring parsing complete", (name, reason) => {
    expect(assessProviderFinancialEmail(fixture(name))).toMatchObject({ status: "review", reasons: expect.arrayContaining([reason]) });
  });

  it("keeps an unknown company distinct from an unsupported registered template", () => {
    const source = { fromAddress: "sce@message.sce.com", subject: "A new kind of notice", body: "$99.99 due tomorrow" };
    expect(assessProviderFinancialEmail(source)).toMatchObject({ status: "review", reasons: ["provider_template_unsupported"] });
    expect(assessProviderFinancialEmail({ ...source, fromAddress: "unknown@example.test" })).toMatchObject({ status: "unrecognized", providerId: null });
  });

  it.each([
    ["sce@message.sce.com", "Payment Reminder"],
    ["usbank@notifications.usbank.com", "Your credit card payment is complete."],
    ["MyAccount@spectrumemails.com", "Your Payment is Due"],
    ["SoFi@o.sofi.org", "Your SoFi Credit Card payment has been posted."],
    ["donotreply@valleyvistaservices.com", "Payment Confirmation"],
    ["service@paypal.com", "Receipt for your payment to Synchrony Bank"],
    ["alerts@info6.citi.com", "Your payment due date is approaching"],
  ])("does not manufacture obligations for %s payment notices", (fromAddress, subject) => {
    expect(assessProviderFinancialEmail({ fromAddress, subject, body: "$500.00" }).status).toBe("nonfinancial");
  });

  it("does not turn a credit balance into a bill", () => {
    expect(assessProviderFinancialEmail(fixture("socalgas-credit"))).toMatchObject({ status: "nonfinancial", reasons: ["statement_has_no_payment_obligation"] });
  });

  it("takes the full card balance, retains minimum due, and does not use funding-account suffixes", () => {
    const statement = assessProviderFinancialEmail(fixture("citi"));
    expect(statement).toMatchObject({ candidate: { amount: 240.88, account_last4: "4321", amount_candidates: expect.arrayContaining([expect.objectContaining({ kind: "minimum_due", value: 41 })]) } });
    const autopay = assessProviderFinancialEmail(fixture("sofi-conflicting-autopay"));
    expect(autopay).toMatchObject({ status: "review", candidate: { amount: null } });
    if (autopay.status === "review") expect(autopay.candidate?.account_last4).toBeUndefined();
  });

  it("distinguishes Chase card suffixes", () => {
    const a = fixture("chase");
    expect(assessProviderFinancialEmail(a)).toMatchObject({ candidate: { account_last4: "5678" } });
    expect(assessProviderFinancialEmail({ ...a, body: a.body.replace(/5678/g, "4321") })).toMatchObject({ candidate: { account_last4: "4321" } });
  });

  it("requires review when a statement names conflicting card destinations", () => {
    const source = fixture("chase");
    expect(assessProviderFinancialEmail({ ...source, body: `${source.body} Account Chase Credit Card (...4321)` })).toMatchObject({ status: "review", reasons: ["provider_account_conflict"] });
  });

  it("does not route another Citi card product through the supported Costco statement family", () => {
    const source = fixture("citi");
    expect(assessProviderFinancialEmail({ ...source, body: source.body.replace(/Costco Anywhere Visa/g, "Other Citi Card") })).toMatchObject({ status: "review", reasons: ["provider_card_product_unsupported"] });
  });

  it("ignores Citi's custom threshold but preserves an actual two-dollar transaction", () => {
    const source = fixture("citi-purchase");
    const r = assessProviderFinancialEmail({ ...source, subject: source.subject.replace("48.52", "2.00"), body: source.body.replace(/48\.52/g, "2.00") });
    expect(r).toMatchObject({ status: "parsed", candidate: { amount: 2 } });
    if (r.status === "parsed") expect(r.candidate.amount_candidates).toHaveLength(1);
  });

  it("does not use a Citi threshold or unlabelled amount when the transaction amount row is missing", () => {
    const source = fixture("citi-purchase");
    expect(assessProviderFinancialEmail({ ...source, body: source.body.replace("Amount: $48.52", "") })).toMatchObject({
      status: "review", reasons: expect.arrayContaining(["provider_amount_missing"]), candidate: { amount: null },
    });
  });

  it.each([
    ["Amount Due $10.00 Amount Due $20.00 Due Date 09/14/2026", "provider_amount_conflict"],
    ["Amount Due $10.00 Due Date 09/14/2026 Due Date 09/15/2026", "provider_date_conflict"],
    ["Amount Due $10.00 Due Date 02/30/2026", "provider_date_missing"],
    ["Minimum Due $10.00 Due Date 09/14/2026", "provider_amount_missing"],
    ["Amount Due $10.00 CAD Due Date 09/14/2026", "provider_currency_unsupported"],
  ])("rejects ambiguous or unsupported evidence: %s", (body, reason) => {
    expect(assessProviderFinancialEmail({ ...fixture("sce"), body })).toMatchObject({ status: "review", reasons: expect.arrayContaining([reason]) });
  });

  it("resolves a yearless SoFi due date only within the received statement's billing horizon", () => {
    const source = fixture("sofi");
    expect(assessProviderFinancialEmail({ ...source, emailDate: "2025-12-15T00:00:00Z", body: source.body.replace(/10\/05/g, "01/05") })).toMatchObject({ status: "parsed", candidate: { due_date: "2026-01-05" } });
    expect(assessProviderFinancialEmail({ ...source, emailDate: null })).toMatchObject({ status: "review", candidate: { due_date: null } });
  });

  it("preserves initial-order context without inventing a source date", () => {
    expect(assessProviderFinancialEmail(fixture("amazon"))).toMatchObject({ status: "parsed", candidate: { amount: 9.77, due_date: null, purchase_date_context: { kind: "initial_confirmation_without_date" } } });
  });

  it("requires readable Valley Vista invoice facts and supports separately supplied extracted attachments", () => {
    const source = fixture("valley-vista");
    const [body, attachment] = source.body.split("[Begin extracted PDF text]");
    expect(assessProviderFinancialEmail({ ...source, body: body! })).toMatchObject({ status: "review", reasons: expect.arrayContaining(["provider_amount_missing"]) });
    expect(assessProviderFinancialEmail({ ...source, body: body!, attachments: [{ filename: "invoice.pdf", text: attachment! }] })).toMatchObject({ status: "parsed", candidate: { amount: 119.01, due_date: "2026-08-07" } });
  });
});
