import { describe, it, expect } from "vitest";
import { normalizeText } from "./calendarSearchMirrorStatements.ts";

describe("normalizeText", () => {
  it("normalizeText trims, lowercases, and collapses whitespace", () => {
    expect(normalizeText("  Final   Presentation\n Room ")).toBe("final presentation room");
    expect(normalizeText(null)).toBe("");
  });
});
