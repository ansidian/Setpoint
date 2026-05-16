import { describe, expect, it } from "vitest";
import { getMissingRequiredEnv } from "./env.js";

describe("required env validation", () => {
  it("requires Turso credentials only in production", () => {
    const baseEnv = {
      EA_USER_ID: "user-1",
      EA_PASSWORD_HASH: "hash",
      EA_ENCRYPTION_KEY: "a".repeat(64),
    };

    expect(getMissingRequiredEnv({ ...baseEnv, NODE_ENV: "development" })).toEqual([]);
    expect(getMissingRequiredEnv({ ...baseEnv, NODE_ENV: "production" })).toEqual([
      "TURSO_DATABASE_URL",
      "TURSO_AUTH_TOKEN",
      "EA_WEBAUTHN_RP_NAME",
      "EA_WEBAUTHN_RP_ID",
      "EA_WEBAUTHN_ORIGIN",
    ]);
    expect(getMissingRequiredEnv({
      ...baseEnv,
      NODE_ENV: "production",
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      TURSO_AUTH_TOKEN: "token",
      EA_WEBAUTHN_RP_NAME: "Setpoint",
      EA_WEBAUTHN_RP_ID: "dashboard.example.com",
      EA_WEBAUTHN_ORIGIN: "https://dashboard.example.com",
    })).toEqual([]);
  });
});
