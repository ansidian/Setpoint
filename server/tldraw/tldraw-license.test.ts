import { webcrypto } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { createTldrawCredentialManager, validateTldrawLicense } from "./tldraw-license.ts";

function unsignedLicenseForHosts(hosts: string[]): string {
  const encoded = Buffer.from(JSON.stringify([
    "license-id",
    hosts,
    9,
    "2027-08-25",
  ])).toString("base64");
  return `tldraw-test/${encoded}.c2lnbmF0dXJl`;
}

describe("tldraw license validation", () => {
  it("rejects malformed values", async () => {
    await expect(validateTldrawLicense("not-a-license", "https://setpoint.example")).resolves.toBe("INVALID_CREDENTIAL");
  });

  it("accepts tldraw's wildcard host form on the canonical hostname", async () => {
    const verify = vi.spyOn(webcrypto.subtle, "verify").mockResolvedValue(true);
    try {
      await expect(validateTldrawLicense(
        unsignedLicenseForHosts(["*.dashboard.example.com"]),
        "https://dashboard.example.com",
        Date.UTC(2026, 7, 25),
      )).resolves.toBe("VALID");
    } finally {
      verify.mockRestore();
    }
  });

  it("promotes only a locally validated pending license", async () => {
    let promoted: { key: string; version: number } | null = null;
    let failed = false;
    const credentials = {
      readPending: async () => ({ value: "signed-license", version: 4 }),
      promotePending: async (key: string, version: number) => {
        promoted = { key, version };
        return { key };
      },
      recordPendingFailure: async () => {
        failed = true;
        return {};
      },
    };
    const manager = createTldrawCredentialManager({
      credentials: credentials as never,
      canonicalOrigin: async () => "https://setpoint.example",
      validate: async () => "VALID",
    });

    await expect(manager.testPending()).resolves.toMatchObject({ ok: true, code: "VALID" });
    expect(promoted).toEqual({ key: "notes.tldraw_license_key", version: 4 });
    expect(failed).toBe(false);
  });
});
