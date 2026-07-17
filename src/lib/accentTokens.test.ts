import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Shared controls must reference --ea-accent, never the frozen #cba6da / rgb 203,166,218,
// or user accent changes won't propagate.
const MIGRATED = [
  "src/components/ui/button.tsx",
  "src/components/ui/switch.tsx",
  "src/components/shared/EmptyStateSplash.tsx",
];

describe("shared controls use the accent token, not frozen lavender", () => {
  for (const file of MIGRATED) {
    it(`${file} has no hard-coded accent literal`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/#cba6da/i);
      expect(src).not.toMatch(/203,\s*166,\s*218/);
    });
  }
});
