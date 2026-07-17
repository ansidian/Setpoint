import { describe, expect, it } from "vitest";
import {
  addChip,
  flattenActualCategories,
  normalizeBehavior,
  optionWithStoredLabel,
  targetWarning,
} from "./billPayMappingsModel";

describe("addChip", () => {
  it("dedupes case-insensitively instead of appending a near-duplicate", () => {
    expect(addChip(["Citi"], "citi")).toEqual(["Citi"]);
    expect(addChip(["citi.com"], "CITI.COM")).toEqual(["citi.com"]);
  });

  it("trims the value and appends genuinely new chips", () => {
    expect(addChip(["Citi"], "  Chase  ")).toEqual(["Citi", "Chase"]);
  });

  it("ignores blank values and normalizes the source it returns", () => {
    expect(addChip([" Citi ", "", null], "   ")).toEqual(["Citi"]);
  });
});

describe("normalizeChips (via addChip + normalizeBehavior)", () => {
  it("flattens nested arrays and trims when re-reading a source", () => {
    expect(addChip([["  alerts ", "billing "], "ops "], "support")).toEqual([
      "alerts",
      "billing",
      "ops",
      "support",
    ]);
  });

  it("flattens + trims intent chip fields through the behavior normalizer", () => {
    const behavior = normalizeBehavior({
      intent: {
        subject: [["  payment due ", "statement "], "", "  ready"],
        body: [" balance "],
      },
    });

    expect(behavior.intent.subject).toEqual(["payment due", "statement", "ready"]);
    expect(behavior.intent.body).toEqual(["balance"]);
  });
});

describe("normalizeTargets (via normalizeBehavior)", () => {
  it("keeps only whitelisted target fields and drops falsy + unknown ones", () => {
    const behavior = normalizeBehavior({
      targets: {
        payee_id: "payee-citi",
        payee_label: "Citi",
        category_id: "",
        unknown_field: "drop me",
        schedule_name: "Citi schedule",
      },
    } as Parameters<typeof normalizeBehavior>[0]);

    expect(behavior.targets).toEqual({
      payee_id: "payee-citi",
      payee_label: "Citi",
      schedule_name: "Citi schedule",
    });
  });
});

describe("flattenActualCategories", () => {
  it("flattens grouped categories into {id, name, group} entries", () => {
    const result = flattenActualCategories([
      {
        group_name: "Bills",
        categories: [
          { id: "cat-card", name: "Credit Card Payments" },
          { id: "cat-gas", name: "Gas" },
        ],
      },
    ]);

    expect(result).toEqual([
      { id: "cat-card", name: "Credit Card Payments", group: "Bills" },
      { id: "cat-gas", name: "Gas", group: "Bills" },
    ]);
  });

  it("passes through already-flat entries and drops falsy ones", () => {
    expect(flattenActualCategories([{ id: "flat", name: "Flat" }, null])).toEqual([
      { id: "flat", name: "Flat" },
    ]);
    expect(flattenActualCategories()).toEqual([]);
  });
});

describe("optionWithStoredLabel", () => {
  it("injects a missing stored option at the front when the id is absent", () => {
    const options = [{ id: "payee-citi", name: "Citi" }];

    expect(optionWithStoredLabel(options, "payee-old", "Old Payee", "Payee")).toEqual([
      { id: "payee-old", name: "Old Payee", missing: true, missingLabel: "Payee missing" },
      { id: "payee-citi", name: "Citi" },
    ]);
  });

  it("falls back to the id as the name when no stored label is given", () => {
    expect(optionWithStoredLabel([], "payee-old", "", "Payee")[0]).toMatchObject({
      id: "payee-old",
      name: "payee-old",
      missing: true,
    });
  });

  it("returns options untouched when the id is empty or already present", () => {
    const options = [{ id: "payee-citi", name: "Citi" }];

    expect(optionWithStoredLabel(options, "", "Whatever", "Payee")).toBe(options);
    expect(optionWithStoredLabel(options, "payee-citi", "Citi", "Payee")).toBe(options);
  });
});

describe("targetWarning", () => {
  it("warns with the stored label when a target id is missing from options", () => {
    expect(
      targetWarning([{ id: "payee-citi", name: "Citi" }], "payee-old", "Old Payee", "Payee"),
    ).toBe("Payee missing: Old Payee");
  });

  it("falls back to the id when no stored label is present", () => {
    expect(targetWarning([], "payee-old", "", "Payee")).toBe("Payee missing: payee-old");
  });

  it("returns null when the id is empty or resolves to a known option", () => {
    expect(targetWarning([], "", "Old Payee", "Payee")).toBeNull();
    expect(
      targetWarning([{ id: "payee-citi", name: "Citi" }], "payee-citi", "Citi", "Payee"),
    ).toBeNull();
  });
});
