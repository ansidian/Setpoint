import { describe, expect, it, vi } from "vitest";
import { parseTransactionEmail } from "./parser-registry.ts";
import {
  amazonMultiHtml,
  amazonSingleHtml,
  emailFixture,
  paypalPaidText,
  paypalSubmittedText,
} from "./fixtures.ts";

function onlyCandidate(result: ReturnType<typeof parseTransactionEmail>) {
  expect(result.kind).toBe("matched");
  if (result.kind !== "matched") throw new Error("Expected matched result");
  expect(result.candidates).toHaveLength(1);
  return result.candidates[0]!;
}

describe("transaction parser registry", () => {
  it("ports the essential Amazon fields and legacy imported ID", () => {
    const candidate = onlyCandidate(parseTransactionEmail(emailFixture({ html: amazonSingleHtml, text: null })));
    expect(candidate).toMatchObject({
      source: "amazon",
      externalId: "111-2222222-3333333",
      importedId: "amazon-111-2222222-3333333",
      date: "2026-07-21",
      amountCents: -2704,
      currency: "USD",
      payee: "Amazon",
      gmailMessageId: "msg-1",
    });
    expect(candidate.warnings.filter((warning) => warning.blocking)).toEqual([]);
  });

  it("emits distinct Amazon candidates only with independently supported totals", () => {
    const result = parseTransactionEmail(emailFixture({ html: amazonMultiHtml, text: null }));
    expect(result.kind).toBe("matched");
    if (result.kind !== "matched") return;
    expect(result.candidates.map((candidate) => [candidate.importedId, candidate.amountCents])).toEqual([
      ["amazon-111-2222222-3333333", -1308],
      ["amazon-444-5555555-6666666", -872],
    ]);
  });

  it("supports Amazon digital-order subjects and forwarded cents-only total formatting", () => {
    const candidate = onlyCandidate(parseTransactionEmail(emailFixture({
      from: "digital-no-reply@amazon.com",
      subject: "Your digital order",
      text: "Order 111-2222222-3333333 Grand Total: $1390",
    })));
    expect(candidate).toMatchObject({ amountCents: -1390, importedId: "amazon-111-2222222-3333333" });
  });

  it("rejects an ambiguous Amazon multi-order body instead of sharing a total", () => {
    const result = parseTransactionEmail(emailFixture({
      html: null,
      text: "111-2222222-3333333 444-5555555-6666666 Order Total: $20.00",
    }));
    expect(result).toEqual({ kind: "rejected", source: "amazon", reasons: ["ambiguous_multi_order"] });
  });

  it("ports ordinary PayPal fields and the legacy imported ID", () => {
    const candidate = onlyCandidate(parseTransactionEmail(emailFixture({
      from: "PayPal <service@paypal.com>",
      subject: "You paid $5.00 USD to Valve Corp.",
      text: paypalPaidText,
    })));
    expect(candidate).toMatchObject({
      source: "paypal",
      externalId: "1AB23456CD789012E",
      importedId: "paypal-1AB23456CD789012E",
      amountCents: -500,
      currency: "USD",
      payee: "Valve Corp",
    });
    expect(candidate.notes).toContain("PayPal Transaction: 1AB23456CD789012E");
    expect(candidate.warnings.filter((warning) => warning.blocking)).toEqual([]);
  });

  it("supports submitted-order subjects and O- transaction IDs", () => {
    const candidate = onlyCandidate(parseTransactionEmail(emailFixture({
      from: "service@paypal.com",
      subject: "You submitted an order in the amount of $32.95 USD to The Home Depot",
      text: paypalSubmittedText,
    })));
    expect(candidate).toMatchObject({
      importedId: "paypal-O-1AB23456CD789012E",
      amountCents: -3295,
      payee: "The Home Depot",
    });
  });

  it("supports merchant-first PayPal subjects", () => {
    const candidate = onlyCandidate(parseTransactionEmail(emailFixture({
      from: "service@intl.paypal.com",
      subject: "Valve Corp.: $5.00 USD",
      text: "Transaction ID: 1AB23456CD789012E",
    })));
    expect(candidate).toMatchObject({ amountCents: -500, payee: "Valve Corp" });
  });

  it.each([
    [
      "Receipt for your payment to Example Merchant",
      "Total: $12.34 USD\nPayment to Example Merchant\nTransaction ID: 1AB23456CD789012E",
      -1234,
      "Example Merchant",
    ],
    [
      "You've sent a payment",
      "You sent $7.25 USD to Sanitized Person\nTransaction ID: 1AB23456CD789012E",
      -725,
      "Sanitized Person",
    ],
  ])("supports the PayPal subject family: %s", (subject, text, amountCents, payee) => {
    const candidate = onlyCandidate(parseTransactionEmail(emailFixture({
      from: "service@paypal.com",
      subject,
      text,
    })));
    expect(candidate).toMatchObject({ amountCents, payee, importedId: "paypal-1AB23456CD789012E" });
  });

  it.each([
    ["invalid date", { date: "not-a-date" }, "rejected"],
    ["zero amount", { text: "111-2222222-3333333 Order Total: $0.00" }, "rejected"],
  ])("rejects %s", (_name, overrides, expectedKind) => {
    const result = parseTransactionEmail(emailFixture(overrides));
    expect(result.kind).toBe(expectedKind);
  });

  it("emits a blocking warning when the sender is not an exact match", () => {
    const candidate = onlyCandidate(parseTransactionEmail(emailFixture({
      from: "Spoof <auto-confirm@amazon.com.attacker.test>",
    })));
    expect(candidate.warnings).toContainEqual(expect.objectContaining({ code: "untrusted_sender", blocking: true }));
  });

  it("keeps candidates with missing IDs or foreign currency for review", () => {
    const noId = onlyCandidate(parseTransactionEmail(emailFixture({
      subject: "Order confirmation",
      text: "Order Total: $12.00",
    })));
    expect(noId.gmailMessageId).toBe("msg-1");
    expect(noId.importedId).toBeNull();
    expect(noId.externalId).toBeNull();
    expect(noId.warnings).toContainEqual(expect.objectContaining({ code: "missing_external_id", blocking: true }));

    const foreign = onlyCandidate(parseTransactionEmail(emailFixture({
      from: "service@paypal.com",
      subject: "You paid $5.00 CAD to Merchant",
      text: "Transaction ID: 1AB23456CD789012E",
    })));
    expect(foreign.currency).toBe("CAD");
    expect(foreign.warnings).toContainEqual(expect.objectContaining({ code: "unsupported_currency", blocking: true }));
  });

  it("performs no network calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    parseTransactionEmail(emailFixture({ html: amazonSingleHtml, text: null }));
    // test-architecture: allow-boundary-interaction -- Global fetch is the outbound network boundary; this parser safety contract is specifically that parsing untrusted email never initiates a request.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
