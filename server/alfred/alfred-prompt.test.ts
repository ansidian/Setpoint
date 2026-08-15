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
    expect(prompt).toContain("cannot directly modify anything");
    expect(prompt).toContain("propose_calendar_event");
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

  it("invites brief narration and allows structured Markdown only when it improves scanability", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    const lower = prompt.toLowerCase();
    // The owner wants to watch Alfred think as it works: the model is told to
    // narrate its steps, not to suppress them.
    expect(lower).toMatch(/narrate|follow your thinking|say what you/);
    expect(lower).not.toMatch(/work quietly|do not narrate/);
    // …but kept brief, so it reads like an agentic trail rather than a wall.
    expect(lower).toMatch(/one short|single sentence|brief/);
    expect(lower).toContain("opening sentence");
    expect(lower).toMatch(/markdown bullets|numbered list/);
    expect(lower).toMatch(/ordinary paragraph|short answer/);
    expect(lower).toMatch(/markdown header/);
    expect(lower).toContain("raw html");
  });

  it("orders the headline answer after the citation tools, not before", () => {
    // The answer must be the run's LAST prose so it lands as the completed rich
    // text block (with show_items/group_items/summarize rows rendered above it).
    // If the model wrote it before citing, the panel would tag it as preamble.
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/never before|after (any )?(show_items|citation|cite)/);
  });

  it("forbids permission-seeking sign-offs and hedged counts when an exact answer is obtainable", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    const lower = prompt.toLowerCase();
    // No "would you like me to…" trailing offers when the question was already a direct ask.
    expect(lower).toMatch(/do not end with|offer to do more/);
    // Commit to an exact figure instead of "approximately"/"10+".
    expect(lower).toMatch(/exact count|exact number/);
    expect(lower).toContain("approximately");
  });

  it("warns that search results are relevance-ranked, not newest-first, and gives the latest-X recipe (audit C6)", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-07-01T12:00:00-07:00") });
    const lower = prompt.toLowerCase();
    expect(lower).toContain("relevance-ranked");
    expect(lower).toContain("newest-first");
    // The recipe: compare dates across matches, or constrain the window.
    expect(lower).toMatch(/latest|most recent/);
    expect(lower).toMatch(/compare (the )?date|date field/);
    expect(lower).toContain("after");
  });

  it("instructs the model to use group_items for grouping/distribution questions, keyed on shape not vocabulary", () => {
    const prompt = buildAlfredSystemPrompt({ now: new Date("2026-06-14T12:00:00-07:00") });
    expect(prompt).toContain("group_items");
    expect(prompt.toLowerCase()).toMatch(/how many|break these down|distribution/);
    // Generality guard: the trigger must not be phrased around a single domain.
    expect(prompt.toLowerCase()).not.toContain("job application");
  });
});
