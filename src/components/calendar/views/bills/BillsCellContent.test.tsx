import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BillUtilsModule from "../../../../lib/bill-utils";

// Control the urgency bucket deterministically (daysUntil reads the real Pacific
// clock) while exercising the REAL urgencyColor — its actual return values are
// what the amount-color logic depends on.
vi.mock("../../../../lib/bill-utils", async (importOriginal) => {
  const actual = await importOriginal() as typeof BillUtilsModule;
  return { ...actual, daysUntil: vi.fn() };
});

import { daysUntil, urgencyColor } from "../../../../lib/bill-utils";
import { resolveBillChipMetrics, toBillDescriptor, toTransactionDescriptor } from "./BillsCellContent.tsx";
import type { FinanceItem } from "./billsModel.ts";

function makeBill(overrides: Partial<FinanceItem> = {}): FinanceItem {
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

  it("keeps transfers informational blue", () => {
    vi.mocked(daysUntil).mockReturnValue(30);
    expect(toBillDescriptor(makeBill({ type: "transfer" })).leadingColor).toBe("#89b4fa");
  });
});

describe("resolveBillChipMetrics identity cache (PERF-01)", () => {
  it("returns the referentially-same metrics object for the same layout object", () => {
    const layout = { tier: "lg" };
    const first = resolveBillChipMetrics(layout);
    const second = resolveBillChipMetrics(layout);
    expect(second).toBe(first);
  });

  it("returns a different metrics object for a different layout object, even with identical values", () => {
    const layoutA = { tier: "lg" };
    const layoutB = { tier: "lg" };
    const metricsA = resolveBillChipMetrics(layoutA);
    const metricsB = resolveBillChipMetrics(layoutB);
    expect(metricsB).not.toBe(metricsA);
    expect(metricsB).toEqual(metricsA);
  });

  it("returns different metrics content for different layout tiers", () => {
    const lg = resolveBillChipMetrics({ tier: "lg" });
    const md = resolveBillChipMetrics({ tier: "md" });
    expect(lg).not.toEqual(md);
  });

  it("does not throw for a missing layout", () => {
    expect(() => resolveBillChipMetrics(undefined)).not.toThrow();
  });
});

describe("toTransactionDescriptor", () => {
  it("uses signed, non-color direction cues for inflows and outflows", () => {
    expect(toTransactionDescriptor({
      id: "income-1",
      payee: "Employer",
      amount: 5000,
      direction: "income",
      type: "transaction",
    })).toMatchObject({
      title: "Employer",
      leadingLabel: "+$5,000.00",
      detail: "Inflow",
      detailKind: "transaction",
      accent: "#89dceb",
    });
    expect(toTransactionDescriptor({
      id: "expense-1",
      payee: "Market",
      amount: 42.1,
      direction: "expense",
      type: "transaction",
    })).toMatchObject({
      title: "Market",
      leadingLabel: "−$42.10",
      detail: "Outflow",
      detailKind: "transaction",
      accent: "#b4befe",
    });
  });
});
