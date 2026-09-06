import { describe, expect, it } from "vitest";
import { buildAlfredSystemPrompt } from "./alfred-prompt.ts";

describe("buildAlfredSystemPrompt", () => {
  it("anchors the current date in Pacific time", () => {
    // 2026-06-12T03:30:00Z is still Thursday June 11 in America/Los_Angeles (PDT).
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-12T03:30:00.000Z") });
    expect(prompt).toContain("Thursday, June 11, 2026");
    expect(prompt).toContain("Pacific");
  });

  it("is byte-identical across times within the same Pacific day, so the prompt cache survives", () => {
    const a = buildAlfredSystemPrompt({ now: new Date("2026-06-12T18:00:00.000Z") });
    const b = buildAlfredSystemPrompt({ now: new Date("2026-06-12T18:01:00.000Z") });
    expect(a).toBe(b);
  });
});
