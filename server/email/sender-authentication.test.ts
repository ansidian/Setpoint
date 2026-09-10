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
      // AUID alone does not identify the signing d= domain; DMARC still passes.
      dkim: [{ result: "pass", domain: null, aligned: false }],
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
      dkim: [{ result: "pass", domain: null, aligned: false }],
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

describe("Gmail exact DKIM sender authority without a DMARC verdict", () => {
  const from = "Billing <notice@billing.example.com>";
  const prefix = "AbCdEf12";
  const signature = (tags = "") => ({ name: "DKIM-Signature", value: `v=1; a=rsa-sha256; d=billing.example.com; s=mail; h=from:subject:date; bh=Qm9keUhhc2g=; b=${prefix}U2FuaXRpemVkU2lnbmF0dXJl; ${tags}` });
  const evaluate = (results: string, signatures: Array<{ name: string; value: string }> = []) => evaluateGmailSenderAuthentication([
    { name: "From", value: from },
    { name: "Authentication-Results", value: `mx.google.com; ${results}` },
    ...signatures,
  ], from, now);

  it("accepts the trusted exact signing domain and keeps DMARC absent", () => {
    expect(evaluate("dkim=pass header.d=billing.example.com; dkim=pass header.d=amazonses.com; spf=pass smtp.mailfrom=us-west-2.amazonses.com")).toMatchObject({
      status: "pass", headerFromDomain: "billing.example.com", dmarc: null,
      dkim: [{ result: "pass", domain: "billing.example.com", aligned: true }, { result: "pass", domain: "amazonses.com", aligned: false }],
      spf: { result: "pass", domain: "us-west-2.amazonses.com", aligned: false },
    });
  });

  it("associates Gmail's i-only result with exactly one original signature using its case-sensitive b prefix and selector", () => {
    const result = evaluate(`dkim=pass header.i=@billing.example.com header.s=mail header.b="${prefix}"; dkim=pass header.i=@amazonses.com header.s=ses header.b=SesOther`, [
      signature(),
      { name: "DKIM-Signature", value: "v=1; a=rsa-sha256; d=amazonses.com; s=ses; b=SesOtherU2lnbmF0dXJl;" },
    ]);
    expect(result).toMatchObject({ status: "pass", dmarc: null, dkim: [
      { result: "pass", domain: "billing.example.com", aligned: true },
      { result: "pass", domain: "amazonses.com", aligned: false },
    ] });
    expect(JSON.stringify(result)).not.toContain(prefix);
    expect(JSON.stringify(result)).not.toContain("selector");
  });

  it.each([
    ["header.d=example.com header.i=@billing.example.com", "example.com"],
    ["header.d=attacker.example.com header.i=@billing.example.com", null],
    ["header.d=billing.example.com header.i=@attacker.example.com", null],
    ["header.d=billing.example.com.attacker.test", "billing.example.com.attacker.test"],
    ["header.d=mail.billing.example.com", "mail.billing.example.com"],
    ["header.i=@billing.example.com", null],
  ])("requires exact d alignment, independently of %s", (properties, domain) => {
    expect(evaluate(`dkim=pass ${properties}`)).toMatchObject({ status: "unavailable", dmarc: null, dkim: [{ domain, aligned: false }] });
  });

  it("uses a directly reported d domain even when its valid AUID names a subdomain", () => {
    expect(evaluate("dkim=pass header.d=billing.example.com header.i=@mail.billing.example.com")).toMatchObject({ status: "pass", dkim: [{ domain: "billing.example.com", aligned: true }] });
  });

  it.each([
    ["fail", "billing.example.com", "fail"],
    ["pass", "attacker.example.com", "fail"],
    ["none", "billing.example.com", "none"],
    ["temperror", "billing.example.com", "unavailable"],
    ["permerror", "billing.example.com", "unavailable"],
    ["bestguesspass", "billing.example.com", "unavailable"],
  ])("does not override explicit DMARC %s for %s", (result, domain, status) => {
    expect(evaluate(`dkim=pass header.d=billing.example.com; dmarc=${result} header.from=${domain}`)).toMatchObject({
      status, dmarc: { result, domain, aligned: domain === "billing.example.com" },
    });
  });

  it.each([
    "dkim=fail header.d=billing.example.com",
    "spf=pass smtp.mailfrom=billing.example.com",
    "dkim=pass (header.d=billing.example.com) header.d=attacker.test",
    'dkim=pass reason="header.d=billing.example.com" header.d=attacker.test',
    "dkim=pass header.d=billing.example.com header.d=attacker.test",
    "dkim=pass header.d=billing.example.com; dmarc=pass header.from=billing.example.com; dmarc=fail header.from=billing.example.com",
    "dkim=pass header.d=billing.example.com; dkim=fail header.d=billing.example.com",
    "dkim=pass header.d=billing.example.com; dkim=fail header.i=@billing.example.com header.s=mail",
    "none; dkim=pass header.d=billing.example.com",
    `dkim=pass header.d=billing.example.com header.b=${prefix}; dkim=fail header.d=billing.example.com header.b=${prefix}`,
    `dkim=pass header.i=@billing.example.com header.s=wrong header.b=${prefix}`,
    `dkim=pass header.i=@billing.example.com header.s=mail header.b=${prefix.toLowerCase()}`,
    `dkim=pass header.i=@billing.example.com header.s=mail header.b=${prefix.slice(0, 7)}`,
    `dkim=pass header.i=other@billing.example.com header.s=mail header.b=${prefix}`,
  ])("does not authorize missing, failed, forged or ambiguous evidence: %s", (result) => {
    expect(evaluate(result, [signature()]).status).toBe("unavailable");
  });

  it("accepts one valid aligned signature alongside a distinct failed signature", () => {
    expect(evaluate(`dkim=pass header.d=billing.example.com header.b=${prefix}; dkim=fail header.d=billing.example.com header.b=OtherSig`)).toMatchObject({ status: "pass", dmarc: null });
  });

  it("rejects duplicate Google verdicts and never promotes an untrusted first result", () => {
    const result = `mx.google.com; dkim=pass header.d=billing.example.com`;
    for (const leading of [result, "attacker.test; dkim=pass header.d=billing.example.com"]) {
      expect(evaluateGmailSenderAuthentication([
        { name: "From", value: from }, { name: "Authentication-Results", value: leading },
        { name: "Authentication-Results", value: result },
      ], from, now).status).toBe("unavailable");
    }
  });

  it("does not infer a signer from absent, colliding, inconsistent, or partially signed originals", () => {
    const result = `dkim=pass header.i=@billing.example.com header.s=mail header.b=${prefix}`;
    for (const signatures of [[], [signature(), signature()], [signature("d=attacker.test;")], [signature("l=100;")], [signature("i=other@billing.example.com;")]]) {
      expect(evaluate(result, signatures).status).toBe("unavailable");
    }
    const parentSignature = { ...signature(), value: signature().value.replace("d=billing.example.com", "d=example.com") + " i=@billing.example.com;" };
    expect(evaluate(result, [parentSignature])).toMatchObject({ status: "unavailable", dkim: [{ domain: "example.com", aligned: false }] });
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
