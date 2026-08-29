import { describe, expect, it } from "vitest";
import { normalizeSettingsTab, readTabFromSearchParams } from "./settings-core";

describe("Settings tab routing", () => {
  it.each([
    [null, "connections"],
    ["connections", "connections"],
    ["automation", "automation"],
    ["finance", "finance"],
    ["system", "system"],
    ["accounts", "connections"],
    ["briefing", "automation"],
    ["actual", "finance"],
    ["unknown", "connections"],
  ] as const)("normalizes %s to %s", (value, expected) => {
    expect(normalizeSettingsTab(value)).toBe(expected);
    expect(readTabFromSearchParams(new URLSearchParams(value ? { tab: value } : {}))).toBe(expected);
  });
});
