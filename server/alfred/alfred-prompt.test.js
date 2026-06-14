import { describe, expect, it } from "vitest";
import { buildAlfredSystemPrompt } from "./alfred-prompt.js";

describe("buildAlfredSystemPrompt", () => {
  it("anchors the current date in Pacific time", () => {
    // 2026-06-12T03:30:00Z is still Thursday June 11 in America/Los_Angeles (PDT).
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-12T03:30:00.000Z") });
    expect(prompt).toContain("Thursday, June 11, 2026");
    expect(prompt).toContain("Pacific");
  });

  it("states coverage, cite-by-reference, and untrusted-content rules", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-12T18:00:00.000Z") });
    expect(prompt).toContain("cannot modify anything");
    expect(prompt).toContain("show_items");
    expect(prompt).toContain("<email_content>");
  });
});
