import { describe, expect, it } from "vitest";
import {
  evaluateGmailSenderAuthentication,
  evaluateICloudSenderAuthentication,
  unavailableEmailAuthentication,
} from "./sender-authentication.ts";

const now = new Date("2026-09-01T20:00:00.000Z");

describe("sender authentication projection", () => {
  it("accepts a Google-added aligned DMARC pass and keeps only normalized evidence", () => {
    const result = evaluateGmailSenderAuthentication([
      { name: "From", value: "Billing <notice@billing.example>" },
      {
        name: "Authentication-Results",
        value: "mx.google.com; dkim=pass header.i=@billing.example header.s=mail; spf=pass smtp.mailfrom=bounce@billing.example; dmarc=pass (p=reject) header.from=billing.example",
      },
    ], "Billing <notice@billing.example>", now);

    expect(result).toEqual({
      version: 1,
      status: "pass",
      provider: "gmail",
      source: "gmail_authentication_results",
      headerFromDomain: "billing.example",
      dkim: [{ result: "pass", domain: "billing.example", aligned: true }],
      spf: { result: "pass", domain: "billing.example", aligned: true },
      dmarc: { result: "pass", domain: "billing.example", aligned: true },
      evaluatedAt: now.toISOString(),
    });
    expect(JSON.stringify(result)).not.toContain("bounce@");
  });

  it("fails when Google's evaluated Header-From domain disagrees with the claimed sender", () => {
    const result = evaluateGmailSenderAuthentication([{ name: "From", value: "notice@billing.example" }, {
      name: "Authentication-Results",
      value: "mx.google.com; dmarc=pass header.from=attacker.example",
    }], "notice@billing.example", now);

    expect(result).toMatchObject({ status: "fail", headerFromDomain: "attacker.example" });
  });

  it("does not trust a sender-supplied result even when a later header names Google", () => {
    const result = evaluateGmailSenderAuthentication([
      { name: "From", value: "notice@billing.example" },
      { name: "Authentication-Results", value: "attacker.example; dmarc=pass header.from=billing.example" },
      { name: "Authentication-Results", value: "mx.google.com; dmarc=pass header.from=billing.example" },
    ], "notice@billing.example", now);

    expect(result.status).toBe("unavailable");
  });

  it.each([
    '"service@paypal.com" <service@paypal.com>',
    '"notice@other.example" <service@paypal.com>',
    '"PayPal, billing \\"receipts\\"" <service@paypal.com>',
  ])("authenticates the mailbox independently of quoted display text: %s", (from) => {
    const result = evaluateGmailSenderAuthentication([
      { name: "From", value: from },
      {
        name: "Authentication-Results",
        value: "mx.google.com; dkim=pass header.i=@paypal.com; spf=pass smtp.mailfrom=service@paypal.com; dmarc=pass header.from=paypal.com",
      },
    ], from, now);

    expect(result).toMatchObject({
      status: "pass",
      headerFromDomain: "paypal.com",
      dkim: [{ result: "pass", domain: "paypal.com", aligned: true }],
      spf: { result: "pass", domain: "paypal.com", aligned: true },
      dmarc: { result: "pass", domain: "paypal.com", aligned: true },
    });
  });

  it.each([
    "notice@billing.example, notice@attacker.example",
    "Billing <notice@billing.example>, Attacker <notice@attacker.example>",
    "Billing <notice@billing.example> <notice@billing.example>",
    "notice@billing.example <notice@attacker.example>",
    "Billing <notice@billing.example> trailing text",
    '"notice@billing.example"',
  ])("keeps malformed or multiple sender mailboxes unavailable: %s", (from) => {
    const result = evaluateGmailSenderAuthentication([
      { name: "From", value: from },
      { name: "Authentication-Results", value: "mx.google.com; dmarc=pass header.from=billing.example" },
    ], from, now);

    expect(result).toMatchObject({ status: "unavailable", dkim: [], spf: null, dmarc: null });
  });

  it.each([
    { fromHeaders: [] },
    { fromHeaders: [{ name: "From", value: "notice@attacker.example" }] },
    { fromHeaders: [{ name: "From", value: "notice@billing.example" }, { name: "From", value: "notice@billing.example" }] },
  ])("requires one actual From header consistent with the claimed mailbox: $fromHeaders", ({ fromHeaders }) => {
    const result = evaluateGmailSenderAuthentication([
      ...fromHeaders,
      { name: "Authentication-Results", value: "mx.google.com; dmarc=pass header.from=billing.example" },
    ], "notice@billing.example", now);

    expect(result.status).toBe("unavailable");
  });

  it("keeps iCloud unavailable until receiver-added semantics are proven", () => {
    expect(unavailableEmailAuthentication("icloud", "notice@billing.example", now)).toMatchObject({
      status: "unavailable",
      provider: "icloud",
      headerFromDomain: "billing.example",
    });
  });
});

describe("iCloud sender mailbox authentication", () => {
  const authenticationHeaders = [
    { name: "Received", value: "from p01-icloudmta-smtpin-example by p01-mailgateway-smtp-example (mailgateway)" },
    { name: "Received", value: "from smtp.billing.example by p01-icloudmta-smtpin-example (Postfix)" },
    { name: "X-ICL-Repid", value: "redacted" },
    { name: "X-ICL-Info", value: "redacted" },
    { name: "X-ICL-Score", value: "redacted" },
    { name: "Authentication-Results", value: "bimi.icloud.com; bimi=none" },
    { name: "Authentication-Results", value: "arc.icloud.com; arc=none" },
    { name: "Authentication-Results", value: "dmarc.icloud.com; dmarc=pass header.from=billing.example" },
    { name: "Authentication-Results", value: "dkim-verifier.icloud.com; dkim=pass header.d=billing.example" },
    { name: "Authentication-Results", value: "spf.icloud.com; spf=pass smtp.mailfrom=billing.example" },
  ];

  it.each([
    "Billing <notice@billing.example>",
    '"notice@other.example" <notice@billing.example>',
  ])("uses the actual mailbox with an anchored Apple authentication verdict: %s", (from) => {
    const result = evaluateICloudSenderAuthentication([
      ...authenticationHeaders,
      { name: "From", value: from },
    ], "notice@billing.example", now);

    expect(result).toMatchObject({ status: "pass", headerFromDomain: "billing.example" });
  });

  it.each([
    { fromHeaders: [{ name: "From", value: "notice@billing.example, notice@attacker.example" }] },
    { fromHeaders: [{ name: "From", value: "notice@billing.example" }, { name: "From", value: "notice@billing.example" }] },
  ])("keeps ambiguous From headers unavailable despite an Apple pass: $fromHeaders", ({ fromHeaders }) => {
    const result = evaluateICloudSenderAuthentication([
      ...authenticationHeaders,
      ...fromHeaders,
    ], "notice@billing.example", now);

    expect(result.status).toBe("unavailable");
  });
});
