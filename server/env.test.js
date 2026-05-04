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
    ]);
    expect(getMissingRequiredEnv({
      ...baseEnv,
      NODE_ENV: "production",
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      TURSO_AUTH_TOKEN: "token",
    })).toEqual([]);
  });
});
