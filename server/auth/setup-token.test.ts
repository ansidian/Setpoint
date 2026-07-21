import { describe, expect, it } from "vitest";
import { verifySetupToken } from "./setup-token.ts";

describe("setup token verification", () => {
  it("accepts only the exact configured high-entropy token", () => {
    const configured = "setup-secret-with-at-least-32-characters";

    expect(verifySetupToken(configured, configured)).toEqual({ configured: true, verified: true });
    expect(verifySetupToken("wrong-token-with-at-least-32-characters", configured))
      .toEqual({ configured: true, verified: false });
    expect(verifySetupToken(undefined, configured)).toEqual({ configured: true, verified: false });
  });

  it("fails closed when the deployment secret is missing or too short", () => {
    expect(verifySetupToken("anything", undefined)).toEqual({ configured: false, verified: false });
    expect(verifySetupToken("anything", "short-token")).toEqual({ configured: false, verified: false });
  });
});
