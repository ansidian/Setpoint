import { describe, expect, it } from "vitest";
import { financialEmailSourceIdentity } from "./financialEmailSourceIdentity.ts";

describe("financial email sender identity", () => {
  it("projects persisted normalized evidence without raw authentication headers", () => {
    const identity = financialEmailSourceIdentity({
      account_id: "gmail-work",
      from_address: "notice@billing.example",
      sender_authentication_json: JSON.stringify({
        version: 1,
        status: "pass",
        provider: "gmail",
        source: "gmail_authentication_results",
        headerFromDomain: "billing.example",
        dkim: [{ result: "pass", domain: "billing.example", aligned: true }],
        spf: { result: "pass", domain: "billing.example", aligned: true },
        dmarc: { result: "pass", domain: "billing.example", aligned: true },
        evaluatedAt: "2026-09-01T20:00:00.000Z",
      }),
    });

    expect(identity).toEqual({
      provider: "gmail",
      accountId: "gmail-work",
      senderAddress: "notice@billing.example",
      senderAuthentication: "pass",
      authenticationEvidence: [
        "sender-auth:v1",
        "source:gmail_authentication_results",
        "header-from:billing.example",
        "dmarc:pass",
        "spf:pass",
        "dkim:pass:aligned",
      ],
    });
  });

  it("fails closed for absent or malformed projections", () => {
    expect(financialEmailSourceIdentity({
      account_id: "icloud-main",
      from_address: "notice@billing.example",
      sender_authentication_json: "not-json",
    })).toMatchObject({
      provider: null,
      senderAuthentication: "unavailable",
      authenticationEvidence: [],
    });
  });
});
