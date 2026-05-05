import { describe, expect, it } from "vitest";
import { partitionInboxCategoryFilters } from "./InboxCategoryFilterChipsModel.js";

describe("InboxCategoryFilterChipsModel", () => {
  it("orders category chips by risk band before count", () => {
    const partition = partitionInboxCategoryFilters([
      { category: "marketing", count: 50 },
      { category: "finance", count: 1 },
      { category: "security", count: 1 },
      { category: "legal", count: 1 },
      { category: "school", count: 6 },
      { category: "work", count: 10 },
      { category: "infra", count: 8 },
    ]);

    expect(partition.ordered.map((entry) => entry.category)).toEqual([
      "security",
      "legal",
      "finance",
      "work",
      "infra",
      "school",
      "marketing",
    ]);
    expect(partition.visible.map((entry) => entry.category)).toEqual([
      "security",
      "legal",
      "finance",
      "work",
    ]);
    expect(partition.hidden.map((entry) => entry.category)).toEqual([
      "infra",
      "school",
      "marketing",
    ]);
  });

  it("keeps the visible budget stable when the active category is hidden", () => {
    const partition = partitionInboxCategoryFilters([
      { category: "finance", count: 1 },
      { category: "security", count: 1 },
      { category: "legal", count: 1 },
      { category: "school", count: 1 },
      { category: "marketing", count: 20 },
    ], {
      activeCategory: "marketing",
    });

    expect(partition.visible.map((entry) => entry.category)).toEqual([
      "security",
      "legal",
      "finance",
      "school",
    ]);
    expect(partition.activeHiddenCategory?.category).toBe("marketing");
  });

  it("sorts unexpected fallback categories by count before passive categories", () => {
    const partition = partitionInboxCategoryFilters([
      { category: "marketing", count: 99 },
      { category: "vendor_alerts", count: 2 },
      { category: "alumni", count: 7 },
      { category: "updates", count: 80 },
    ]);

    expect(partition.ordered.map((entry) => entry.category)).toEqual([
      "alumni",
      "vendor_alerts",
      "marketing",
      "updates",
    ]);
  });
});
