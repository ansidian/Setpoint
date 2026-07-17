import { describe, expect, it } from "vitest";
import { resolvePasswordLogin } from "./auth-mode.ts";

describe("owner authentication mode", () => {
  it("keeps password login complete by default even when passkeys exist", () => {
    expect(resolvePasswordLogin("password_or_passkey", 2)).toEqual({
      authenticated: true,
      passkeyRequired: false,
    });
  });

  it("requires a registered passkey only in explicit strict mode", () => {
    expect(resolvePasswordLogin("password_plus_passkey", 1)).toEqual({
      authenticated: false,
      passkeyRequired: true,
    });
    expect(resolvePasswordLogin("password_plus_passkey", 0)).toEqual({
      authenticated: false,
      passkeyRequired: false,
      configurationError: true,
    });
  });
});
