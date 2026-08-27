import { describe, expect, it } from "vitest";

import { toTransactionDescriptor } from "./BillsCellContent.tsx";

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
