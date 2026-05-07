import { describe, expect, it } from "vitest";
import { compactLeadingLabel, getChipLeadingColumnWidth } from "./CalendarCellItemChipModel.js";

describe("CalendarCellItemChipModel", () => {
  it("reserves readable width for compact one-digit time labels", () => {
    expect(compactLeadingLabel("1:00 PM")).toBe("1p");
    expect(getChipLeadingColumnWidth([{ leadingLabel: "1:00 PM" }])).toBeGreaterThanOrEqual(22);
    expect(getChipLeadingColumnWidth([{ leadingLabel: "9:00 AM" }])).toBeGreaterThanOrEqual(22);
  });
});
