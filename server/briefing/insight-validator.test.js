import { describe, it, expect } from "vitest";
import {
  validateInsight,
  validateInsights,
  FORBIDDEN_TEMPORAL_REGEX,
} from "./insight-validator.js";

const goodSlot = { iso: "2026-04-09" };
const goodTimedSlot = { iso: "2026-04-09", time: "20:00" };

describe("validateInsight — happy path", () => {
  it("accepts a single-slot template", () => {
    const r = validateInsight({
      template: "Your task is due {d1}.",
      slots: { d1: goodSlot },
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts a multi-slot template", () => {
    const r = validateInsight({
      template: "Bill auto-pays {d1}, card closes {d2}.",
      slots: { d1: goodSlot, d2: { iso: "2026-04-13" } },
    });
    expect(r.valid).toBe(true);
  });

  it("accepts a template with a timed slot", () => {
    const r = validateInsight({
      template: "The Boys is {cal_1}.",
      slots: { cal_1: goodTimedSlot },
    });
    expect(r.valid).toBe(true);
  });

  it("accepts a template with no date references", () => {
    const r = validateInsight({
      template: "You have 3 urgent emails.",
      slots: {},
    });
    expect(r.valid).toBe(true);
  });
});

describe("validateInsight — forbidden temporal words", () => {
  const cases = [
    ["today", "Your task is due today."],
    ["tomorrow", "Meeting tomorrow at 3pm."],
    ["yesterday", "You missed yesterday's standup."],
    ["tonight", "Dinner tonight at 7."],
    ["this morning", "Coffee this morning?"],
    ["this afternoon", "Review this afternoon."],
    ["this evening", "Meeting this evening."],
    ["last night", "Game last night."],
    ["earlier today", "As mentioned earlier today."],
    ["later today", "Reminder later today."],
    ["this week", "Due this week."],
    ["this weekend", "Free this weekend?"],
    ["next week", "Due next week."],
    ["next Tuesday", "Meeting next Tuesday."],
    ["next Wed", "Due next Wed."],
    ["in 3 days", "Due in 3 days."],
    ["in 2 weeks", "Renews in 2 weeks."],
    ["in a week", "Due in a week."],
    ["in one day", "Due in one day."],
    ["soon", "Payment due soon."],
    ["bare weekday", "Review the SCE bill {d1} on Wed.", { d1: goodSlot }],
    ["parenthetical weekday", "Spotify renewal {d1} (Tue).", { d1: goodSlot }],
    ["full weekday", "Meeting on Wednesday.", {}],
  ];

  for (const [label, template, slots = {}] of cases) {
    it(`rejects "${label}"`, () => {
      const r = validateInsight({ template, slots });
      expect(r.valid).toBe(false);
      expect(r.errors.some(e => e.includes("forbidden temporal"))).toBe(true);
    });
  }

  it("matches case-insensitively", () => {
    const r = validateInsight({ template: "TOMORROW big day.", slots: {} });
    expect(r.valid).toBe(false);
  });

  it("does not false-positive on unrelated words", () => {
    // "soon" would match but we're testing other words here
    const r = validateInsight({
      template: "Review the document before submitting.",
      slots: {},
    });
    expect(r.valid).toBe(true);
  });

  it("does not match mid-word sequences", () => {
    // "today" as a substring should still match via \btoday\b, but something
    // like "todayish" would not. Sanity check: "toward" must not match.
    const r = validateInsight({
      template: "Move toward the exit.",
      slots: {},
    });
    expect(r.valid).toBe(true);
  });
});

describe("validateInsight — slot consistency", () => {
  it("rejects unknown slot ref", () => {
    const r = validateInsight({
      template: "Due {d1} and {d2}.",
      slots: { d1: goodSlot },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("{d2}"))).toBe(true);
  });

  it("rejects unused slot", () => {
    const r = validateInsight({
      template: "Due {d1}.",
      slots: { d1: goodSlot, d2: goodSlot },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("d2") && e.includes("unused"))).toBe(true);
  });

  it("rejects slot with invalid iso", () => {
    const r = validateInsight({
      template: "Due {d1}.",
      slots: { d1: { iso: "04/09/2026" } },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("invalid iso"))).toBe(true);
  });

  it("rejects slot with invalid time", () => {
    const r = validateInsight({
      template: "Due {d1}.",
      slots: { d1: { iso: "2026-04-09", time: "8pm" } },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("invalid time"))).toBe(true);
  });

  it("accepts slot with null time", () => {
    const r = validateInsight({
      template: "Due {d1}.",
      slots: { d1: { iso: "2026-04-09", time: null } },
    });
    expect(r.valid).toBe(true);
  });

  it("rejects slot that is not an object", () => {
    const r = validateInsight({
      template: "Due {d1}.",
      slots: { d1: "2026-04-09" },
    });
    expect(r.valid).toBe(false);
  });
});

describe("validateInsight — structural errors", () => {
  it("rejects null insight", () => {
    const r = validateInsight(null);
    expect(r.valid).toBe(false);
  });

  it("rejects empty template", () => {
    const r = validateInsight({ template: "", slots: {} });
    expect(r.valid).toBe(false);
  });

  it("rejects missing template", () => {
    const r = validateInsight({ slots: {} });
    expect(r.valid).toBe(false);
  });
});

describe("validateInsights — batch", () => {
  it("reports per-insight results", () => {
    const results = validateInsights([
      { template: "Good {d1}.", slots: { d1: goodSlot } },
      { template: "Bad tomorrow.", slots: {} },
      { template: "Also good.", slots: {} },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[2].valid).toBe(true);
    expect(results[1].index).toBe(1);
  });

  it("returns empty array for non-array input", () => {
    expect(validateInsights(null)).toEqual([]);
    expect(validateInsights(undefined)).toEqual([]);
    expect(validateInsights("not array")).toEqual([]);
  });
});

describe("FORBIDDEN_TEMPORAL_REGEX", () => {
  it("is a RegExp", () => {
    expect(FORBIDDEN_TEMPORAL_REGEX).toBeInstanceOf(RegExp);
  });

  it("is case-insensitive", () => {
    expect(FORBIDDEN_TEMPORAL_REGEX.flags).toContain("i");
  });
});
