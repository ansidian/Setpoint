import { describe, expect, it } from "vitest";
import { backgroundWorkersEnabled, getMissingRequiredEnv } from "./env.ts";

describe("required env validation", () => {
  it("retains the root key requirement with local production", () => {
    expect(getMissingRequiredEnv({ NODE_ENV: "production", EA_DB_ADAPTER: "sqlite" })).toEqual(["EA_ENCRYPTION_KEY"]);
    expect(getMissingRequiredEnv({ NODE_ENV: "production", EA_DB_ADAPTER: "sqlite", EA_ENCRYPTION_KEY: "a".repeat(64) })).toEqual([]);
  });

  it("requires explicit valid worker enablement", () => {
    expect(backgroundWorkersEnabled({})).toBe(true);
    expect(backgroundWorkersEnabled({ EA_BACKGROUND_WORKERS_ENABLED: "1" })).toBe(true);
    expect(backgroundWorkersEnabled({ EA_BACKGROUND_WORKERS_ENABLED: "0" })).toBe(false);
    expect(() => backgroundWorkersEnabled({ EA_BACKGROUND_WORKERS_ENABLED: "false" })).toThrow(/must be 0 or 1/);
  });

  it("requires Turso credentials only in production", () => {
    const baseEnv = {
      EA_ENCRYPTION_KEY: "a".repeat(64),
    };

    expect(getMissingRequiredEnv({ ...baseEnv, NODE_ENV: "development" })).toEqual([]);
    expect(getMissingRequiredEnv({ ...baseEnv, NODE_ENV: "production" })).toEqual([
      "TURSO_DATABASE_URL",
      "TURSO_AUTH_TOKEN",
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
