import { describe, expect, it } from "vitest";
import { selectSemanticEventBehavior, semanticTargetPolicies } from "./billSemanticEventPolicy.ts";

describe("semantic target policies", () => {
  it("collapses operationally identical targets despite display-label formatting", () => {
    const behaviors = [
      {
        id: "due",
        type: "transfer",
        targets: {
          from_account_id: "from",
          from_account_label: "Savings (1234)",
          to_account_id: "card",
          to_account_label: "Card\u00a0(0004)",
          schedule_name: "Card\u00a0(0004) Payment",
        },
      },
      {
        id: "statement",
        type: "transfer",
        targets: {
          from_account_id: "from",
          from_account_label: "Renamed Savings",
          to_account_id: "card",
          to_account_label: "Card (0004)",
          schedule_name: "Card (0004) Payment",
        },
      },
    ];

    const result = semanticTargetPolicies(behaviors, { event_kind: "statement_issued" });
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0]!.behaviors).toHaveLength(2);
  });

  it("uses a stable supplied policy key to resolve genuinely distinct targets", () => {
    const behaviors = [
      { id: "fuel", name: "Gas", type: "expense", targets: { category_id: "actual-category-secret-gas", category_label: "Gas" } },
      { id: "store", name: "Warehouse", type: "expense", targets: { category_id: "actual-category-secret-store", category_label: "Costco" } },
    ];
    const first = semanticTargetPolicies(behaviors, { event_kind: "purchase", type: "expense" });
    const second = semanticTargetPolicies([...behaviors].reverse(), { event_kind: "purchase", type: "expense" });
    expect(first.policies.map((policy) => policy.key).sort())
      .toEqual(second.policies.map((policy) => policy.key).sort());
    expect(first.policies.map((policy) => policy.description).join(" "))
      .not.toContain("actual-category-secret");

    const fuel = first.policies.find((policy) => policy.behavior.id === "fuel")!;
    expect(selectSemanticEventBehavior(behaviors, {
      event_kind: "purchase",
      type: "expense",
      target_policy_key: fuel.key,
    })).toMatchObject({ behavior: { id: "fuel" }, reason: null });
  });
});
