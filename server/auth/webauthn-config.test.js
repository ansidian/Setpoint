import { describe, expect, it } from "vitest";
import { resolveWebAuthnConfig } from "./webauthn-config.js";

describe("WebAuthn config", () => {
  it("uses localhost defaults outside production", () => {
    expect(resolveWebAuthnConfig({ NODE_ENV: "development" })).toEqual({
      mode: "development",
      rpName: "Setpoint",
      rpId: "localhost",
      origin: "http://localhost:5173",
    });
  });

  it("derives development RP ID and origin from local request origins", () => {
    expect(resolveWebAuthnConfig(
      { NODE_ENV: "development" },
      { requestOrigin: "http://127.0.0.1:5173" },
    )).toEqual({
      mode: "development",
      rpName: "Setpoint",
      rpId: "127.0.0.1",
      origin: "http://127.0.0.1:5173",
    });

    expect(resolveWebAuthnConfig(
      { NODE_ENV: "development" },
      { requestOrigin: "http://localhost:3000" },
    )).toEqual({
      mode: "development",
      rpName: "Setpoint",
      rpId: "localhost",
      origin: "http://localhost:3000",
    });
  });

  it("requires explicit production WebAuthn config", () => {
    expect(() => resolveWebAuthnConfig({ NODE_ENV: "production" }))
      .toThrow(/EA_WEBAUTHN_RP_NAME, EA_WEBAUTHN_RP_ID, EA_WEBAUTHN_ORIGIN/);
  });

  it("rejects unsafe production origin and RP ID values", () => {
    expect(() => resolveWebAuthnConfig({
      NODE_ENV: "production",
      EA_WEBAUTHN_RP_NAME: "Setpoint",
      EA_WEBAUTHN_RP_ID: "https://dashboard.example.com",
      EA_WEBAUTHN_ORIGIN: "https://dashboard.example.com",
    })).toThrow(/RP ID must be a hostname/);

    expect(() => resolveWebAuthnConfig({
      NODE_ENV: "production",
      EA_WEBAUTHN_RP_NAME: "Setpoint",
      EA_WEBAUTHN_RP_ID: "dashboard.example.com",
      EA_WEBAUTHN_ORIGIN: "http://dashboard.example.com",
    })).toThrow(/must use HTTPS/);
  });

  it("accepts explicit production WebAuthn config", () => {
    expect(resolveWebAuthnConfig({
      NODE_ENV: "production",
      EA_WEBAUTHN_RP_NAME: "Setpoint",
      EA_WEBAUTHN_RP_ID: "dashboard.example.com",
      EA_WEBAUTHN_ORIGIN: "https://dashboard.example.com",
    })).toEqual({
      mode: "production",
      rpName: "Setpoint",
      rpId: "dashboard.example.com",
      origin: "https://dashboard.example.com",
    });
  });
});
