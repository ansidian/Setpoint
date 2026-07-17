import { describe, it, expect } from "vitest";
import { contrastRatio, READABLE_TEXT, BACKGROUND } from "./textContrast";

describe("text token contrast against --background", () => {
  for (const [name, c] of Object.entries(READABLE_TEXT)) {
    it(`${name} meets WCAG AA body (>= 4.5:1)`, () => {
      expect(contrastRatio(c, BACKGROUND)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
