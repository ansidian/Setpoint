import { describe, expect, it } from "vitest";
import { createTldrawCredentialManager, validateTldrawLicense } from "./tldraw-license.ts";

describe("tldraw license validation", () => {
  it("rejects malformed values", async () => {
    await expect(validateTldrawLicense("not-a-license", "https://setpoint.example")).resolves.toBe("INVALID_CREDENTIAL");
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
