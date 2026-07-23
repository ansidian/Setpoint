import { describe, expect, it } from "vitest";
import { projectGmailArrivalEmail } from "./transaction-import-arrivals.ts";

describe("transaction import Gmail arrival adapter", () => {
  it("preserves raw Gmail and RFC message identity while keeping the body transient", () => {
    const result = projectGmailArrivalEmail("gmail-work", {
      uid: "gmail-gmail-work-raw-message-1",
      account_id: "gmail-work",
      account_label: "Work",
      account_email: "owner@example.test",
      from: "Amazon.com <auto-confirm@amazon.com>",
      subject: "Your Amazon.com order #111-2222222-3333333",
      body_preview: "preview",
      body_text: "Order 111-2222222-3333333 Order Total: $27.04",
      date: "Tue, 21 Jul 2026 10:30:00 -0700",
      read: false,
      message_id: "<rfc-message@example.test>",
    });

    expect(result).toMatchObject({
      uid: "gmail-gmail-work-raw-message-1",
      gmailAccountId: "gmail-work",
      gmailMessageId: "raw-message-1",
      internetMessageId: "<rfc-message@example.test>",
      html: null,
      text: expect.stringContaining("Order Total"),
    });
  });
});
