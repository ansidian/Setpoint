import { describe, expect, it } from "vitest";
import { buildAlfredSystemPrompt } from "./alfred-prompt.js";

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

  it("tells the model to search before disclaiming and never ask permission for read-only lookups", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-12T18:00:00.000Z") });
    expect(prompt.toLowerCase()).toContain("search before");
    expect(prompt.toLowerCase()).toContain("birthday");
    expect(prompt.toLowerCase()).toContain("ask permission");
  });

  it("makes show_items a pre-reply step that covers single items", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-12T18:00:00.000Z") });
    expect(prompt).toContain("even a single one");
    expect(prompt.toLowerCase()).toContain("before writing");
  });

  it("states coverage, cite-by-reference, and untrusted-content rules", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-12T18:00:00.000Z") });
    expect(prompt).toContain("cannot modify anything");
    expect(prompt).toContain("show_items");
    expect(prompt).toContain("<email_content>");
  });

  it("covers transactions and drops the can't-read-transactions disclaimer", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    expect(prompt).toMatch(/transactions|spending/i);
    expect(prompt).not.toMatch(/cannot read budget transactions/i);
  });

  it("mentions the breakdown card behavior for spending summaries", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    expect(prompt).toMatch(/breakdown card/i);
  });

  it("mentions income and the summarize_transactions tool name", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    expect(prompt).toMatch(/income/i);
    expect(prompt).toContain("summarize_transactions");
  });

  it("tells the model to work quietly between tool calls and lead with a single title-style line", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    const lower = prompt.toLowerCase();
    expect(lower).toContain("between tool calls");
    expect(lower).toMatch(/do not narrate|progress indicator/);
    expect(lower).toContain("title-style");
    expect(lower).toMatch(/markdown header/);
  });

  it("instructs the model to use group_items for grouping/distribution questions, keyed on shape not vocabulary", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    expect(prompt).toContain("group_items");
    expect(prompt.toLowerCase()).toMatch(/how many|break these down|distribution/);
    // Generality guard: the trigger must not be phrased around a single domain.
    expect(prompt.toLowerCase()).not.toContain("job application");
  });
});
