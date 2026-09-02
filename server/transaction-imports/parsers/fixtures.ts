import type { TransactionEmailInput } from "../transaction-import-types.ts";

export function emailFixture(overrides: Partial<TransactionEmailInput> = {}): TransactionEmailInput {
  return {
    uid: "gmail-personal-msg-1",
    gmailAccountId: "gmail-personal",
    gmailMessageId: "msg-1",
    internetMessageId: "<sanitized@example.test>",
    from: "Amazon.com <auto-confirm@amazon.com>",
    subject: "Your Amazon.com order #111-2222222-3333333",
    date: "Tue, 21 Jul 2026 10:30:00 -0700",
    html: null,
    text: [
      "Order 111-2222222-3333333",
      "1  Stone bath mat  $24.99",
      "Order Total: $27.04",
    ].join("\n"),
    senderAuthentication: {
      version: 1,
      status: "pass",
      provider: "gmail",
      source: "gmail_authentication_results",
      headerFromDomain: "amazon.com",
      dkim: [{ result: "pass", domain: "amazon.com", aligned: true }],
      spf: null,
      dmarc: { result: "pass", domain: "amazon.com", aligned: true },
      evaluatedAt: "2026-07-21T17:30:00.000Z",
    },
    ...overrides,
  };
}

export const amazonSingleHtml = `
  <html><body>
    <p>Order 111-2222222-3333333</p>
    <p>1  Stone bath mat  $24.99</p>
    <strong>Grand Total: $27.04</strong>
  </body></html>`;

export const amazonMultiHtml = `
  <html><body>
    <section>Order 111-2222222-3333333<br>1  Coffee filters  $12.00<br>Order Total: $13.08</section>
    <section>Order 444-5555555-6666666<br>1  USB cable  $8.00<br>Order Total: $8.72</section>
  </body></html>`;

export const paypalPaidText = [
  "You paid $5.00 USD to Valve Corp.",
  "Transaction ID: 1AB23456CD789012E",
  "Item description: Sanitized game purchase",
].join("\n");

export const paypalSubmittedText = [
  "You placed a $32.95 USD order with The Home Depot (merchant)",
  "Transaction ID: O-1AB23456CD789012E",
].join("\n");
