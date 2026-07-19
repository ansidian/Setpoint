import { describe, expect, it } from "vitest";
import { normalizeSettingsTab, readTabFromSearchParams, TABS } from "./settings-core";

describe("Settings tab routing", () => {
  it("uses the locked four-tab information architecture", () => {
    expect(TABS).toEqual([
      { id: "connections", label: "Connections" },
      { id: "automation", label: "Automation" },
      { id: "finance", label: "Finance" },
      { id: "system", label: "System" },
    ]);
  });

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
