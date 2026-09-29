import { describe, expect, it } from "vitest";
import { backgroundWorkersEnabled, getMissingRequiredEnv } from "./env.ts";

describe("required env validation", () => {
  it("requires the root key in every environment", () => {
    expect(getMissingRequiredEnv({ NODE_ENV: "development" })).toEqual(["EA_ENCRYPTION_KEY"]);
    expect(getMissingRequiredEnv({ NODE_ENV: "production" })).toEqual(["EA_ENCRYPTION_KEY"]);
    expect(getMissingRequiredEnv({ NODE_ENV: "production", EA_ENCRYPTION_KEY: "a".repeat(64) })).toEqual([]);
  });

  it("requires explicit valid worker enablement", () => {
    expect(backgroundWorkersEnabled({})).toBe(true);
    expect(backgroundWorkersEnabled({ EA_BACKGROUND_WORKERS_ENABLED: "1" })).toBe(true);
    expect(backgroundWorkersEnabled({ EA_BACKGROUND_WORKERS_ENABLED: "0" })).toBe(false);
    expect(() => backgroundWorkersEnabled({ EA_BACKGROUND_WORKERS_ENABLED: "false" })).toThrow(/must be 0 or 1/);
  });
});
