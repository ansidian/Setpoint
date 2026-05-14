import { describe, expect, it } from "vitest";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
} from "./webauthn-service.js";

const DEV_CONFIG = {
  rpName: "EA Dashboard",
  rpId: "localhost",
  origin: "http://localhost:5173",
};

describe("WebAuthn service", () => {
  it("preserves stored base64url challenges in generated registration options", async () => {
    const challenge = "hRLdSWw1cxKC3GvLrIDJNN6-KzUPXMBsj9VZN09R1lY";

    const options = await buildRegistrationOptions({
      userId: "user-1",
      existingPasskeys: [],
      challenge,
      config: DEV_CONFIG,
    });

    expect(options.challenge).toBe(challenge);
  });

  it("preserves stored base64url challenges in generated authentication options", async () => {
    const challenge = "Wsp2I3HBpcyDnGXs4TkVGQ9wgdEz2Wq6R3X1deuAch8";

    const options = await buildAuthenticationOptions({
      passkeys: [],
      challenge,
      config: DEV_CONFIG,
    });

    expect(options.challenge).toBe(challenge);
  });
});
