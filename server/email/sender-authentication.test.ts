import { describe, expect, it } from "vitest";
import {
  evaluateGmailSenderAuthentication,
  unavailableEmailAuthentication,
} from "./sender-authentication.ts";

const now = new Date("2026-09-01T20:00:00.000Z");

describe("sender authentication projection", () => {
  it("accepts a Google-added aligned DMARC pass and keeps only normalized evidence", () => {
    const result = evaluateGmailSenderAuthentication([
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
    const result = evaluateGmailSenderAuthentication([{
      name: "Authentication-Results",
      value: "mx.google.com; dmarc=pass header.from=attacker.example",
    }], "notice@billing.example", now);

    expect(result).toMatchObject({ status: "fail", headerFromDomain: "attacker.example" });
  });

  it("does not trust a sender-supplied result even when a later header names Google", () => {
    const result = evaluateGmailSenderAuthentication([
      { name: "Authentication-Results", value: "attacker.example; dmarc=pass header.from=billing.example" },
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
