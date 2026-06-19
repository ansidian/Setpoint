import { beforeEach, describe, expect, it, vi } from "vitest";

// Control the urgency bucket deterministically (daysUntil reads the real Pacific
// clock) while exercising the REAL urgencyColor — its actual return values are
// what the amount-color logic depends on.
vi.mock("../../../../lib/bill-utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, daysUntil: vi.fn() };
});

import { daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { toBillDescriptor } from "./BillsCellContent.jsx";

function makeBill(overrides) {
  return {
    id: "b1",
    name: "Narwhal",
    amount: 3.99,
    next_date: "2026-07-26",
    type: "bill",
    paid: false,
    ...overrides,
  };
}

describe("toBillDescriptor amount color by urgency", () => {
  beforeEach(() => vi.mocked(daysUntil).mockReset());

  it("colors a non-urgent (far-future) bill green, not faint gray", () => {
    // Regression guard: the polish pass migrated urgencyColor's faint text to a
    // CSS var, which silently broke the string-equality substitution that turned
    // the non-urgent tone into green — chips went monotone gray.
    vi.mocked(daysUntil).mockReturnValue(30);
    const d = toBillDescriptor(makeBill());
    expect(d.accent).toBe("#a6e3a1");
    expect(d.leadingColor).toBe("#a6e3a1");
  });

  it("colors an overdue bill red", () => {
    vi.mocked(daysUntil).mockReturnValue(-2);
    expect(toBillDescriptor(makeBill()).leadingColor).toBe("#f38ba8");
  });

  it("uses the urgency tone for due-today / tomorrow / soon", () => {
    for (const days of [0, 1, 3]) {
      vi.mocked(daysUntil).mockReturnValue(days);
      expect(toBillDescriptor(makeBill()).leadingColor).toBe(urgencyColor(days).text);
    }
  });

  it("keeps paid bills green regardless of urgency", () => {
    vi.mocked(daysUntil).mockReturnValue(0);
    expect(toBillDescriptor(makeBill({ paid: true })).leadingColor).toBe("#a6e3a1");
  });

  it("keeps transfers lavender", () => {
    vi.mocked(daysUntil).mockReturnValue(30);
    expect(toBillDescriptor(makeBill({ type: "transfer" })).leadingColor).toBe("#b4befe");
  });
});
