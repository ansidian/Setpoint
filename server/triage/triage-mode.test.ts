import { describe, expect, it } from "vitest";
import {
  isAllowedStoredEmailTriageMode,
  normalizeStoredEmailTriageMode,
  resolveEffectiveEmailTriageMode,
} from "./triage-mode.ts";

describe("email triage mode resolver", () => {
  it("accepts only stored control-surface values", () => {
    expect(isAllowedStoredEmailTriageMode("auto")).toBe(true);
    expect(isAllowedStoredEmailTriageMode("real")).toBe(true);
    expect(isAllowedStoredEmailTriageMode("no_model")).toBe(true);
    expect(isAllowedStoredEmailTriageMode("paused")).toBe(true);
    expect(isAllowedStoredEmailTriageMode("disabled")).toBe(false);
    expect(isAllowedStoredEmailTriageMode(null)).toBe(false);
  });

  it("normalizes invalid or null persisted values to auto", () => {
    expect(normalizeStoredEmailTriageMode(null)).toBe("auto");
    expect(normalizeStoredEmailTriageMode("")).toBe("auto");
    expect(normalizeStoredEmailTriageMode("disabled")).toBe("auto");
    expect(normalizeStoredEmailTriageMode("real")).toBe("real");
  });

  it("resolves auto from NODE_ENV", () => {
    expect(resolveEffectiveEmailTriageMode("auto", { nodeEnv: "production" })).toBe("real");
    expect(resolveEffectiveEmailTriageMode("auto", { nodeEnv: "development" })).toBe("no_model");
    expect(resolveEffectiveEmailTriageMode("auto", { nodeEnv: "test" })).toBe("no_model");
    expect(resolveEffectiveEmailTriageMode("auto", { nodeEnv: undefined })).toBe("no_model");
  });

  it("keeps explicit real, no-model, and paused values effective as stored", () => {
    expect(resolveEffectiveEmailTriageMode("real", { nodeEnv: "development" })).toBe("real");
    expect(resolveEffectiveEmailTriageMode("no_model", { nodeEnv: "production" })).toBe("no_model");
    expect(resolveEffectiveEmailTriageMode("paused", { nodeEnv: "production" })).toBe("paused");
  });
});
