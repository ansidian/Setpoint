import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { urgencyColor } from "../../../../lib/bill-utils";
import { toBillDescriptor, toTransactionDescriptor } from "./BillsCellContent.tsx";
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00-07:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("colors a non-urgent (far-future) bill green, not faint gray", () => {
    // Regression guard: the polish pass migrated urgencyColor's faint text to a
    // CSS var, which silently broke the string-equality substitution that turned
    // the non-urgent tone into green — chips went monotone gray.
    const d = toBillDescriptor(makeBill({ next_date: "2026-07-31" }));
    expect(d.accent).toBe("#a6e3a1");
    expect(d.leadingColor).toBe("#a6e3a1");
  });

  it("colors an overdue bill red", () => {
    expect(toBillDescriptor(makeBill({ next_date: "2026-06-29" })).leadingColor).toBe("#f38ba8");
  });

  it("uses the urgency tone for due-today / tomorrow / soon", () => {
    for (const [next_date, days] of [["2026-07-01", 0], ["2026-07-02", 1], ["2026-07-04", 3]] as const) {
      expect(toBillDescriptor(makeBill({ next_date })).leadingColor).toBe(urgencyColor(days).text);
    }
  });

  it("keeps paid bills green regardless of urgency", () => {
    expect(toBillDescriptor(makeBill({ next_date: "2026-07-01", paid: true })).leadingColor).toBe("#a6e3a1");
  });

  it("keeps transfers informational blue", () => {
    expect(toBillDescriptor(makeBill({ next_date: "2026-07-31", type: "transfer" })).leadingColor).toBe("#89b4fa");
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
