import { describe, expect, it } from "vitest";
import {
  compactLeadingLabel,
  getChipLeadingColumnWidth,
  projectCalendarChipContentFit,
  projectCalendarChipStyle,
} from "./CalendarCellItemChipModel";

describe("CalendarCellItemChipModel", () => {
  it("reserves readable width for compact one-digit time labels", () => {
    expect(compactLeadingLabel("1:00 PM")).toBe("1p");
    expect(getChipLeadingColumnWidth([{ leadingLabel: "1:00 PM" }])).toBeGreaterThanOrEqual(22);
    expect(getChipLeadingColumnWidth([{ leadingLabel: "9:00 AM" }])).toBeGreaterThanOrEqual(22);
  });

  it("does not cap preserved leading labels", () => {
    const longAmount = "$1,234,567.89";

    expect(getChipLeadingColumnWidth([{ leadingLabel: longAmount }])).toBe(68);
    expect(getChipLeadingColumnWidth([{ leadingLabel: longAmount, preserveLeadingLabel: true }])).toBeGreaterThan(68);
  });

  it("projects density-aware title fit without exposing render mechanics", () => {
    expect(projectCalendarChipContentFit(
      { leadingLabel: "9:00 AM", title: "Planning block" },
      { itemHeight: 36 },
    )).toEqual({ fontSize: 11, lineHeight: 1.08, lineClamp: 1 });

    expect(projectCalendarChipContentFit(
      { leadingLabel: "All day", title: "A deliberately long special date title", specialDate: true },
      { itemHeight: 32 },
    )).toEqual({ fontSize: 10, lineHeight: 1.06, lineClamp: 2 });
  });

  it("projects selected and ghost container treatments", () => {
    const selected = projectCalendarChipStyle({
      item: { accent: "#89b4fa", leadingLabel: "9:00 AM" },
      selected: true,
      active: false,
      metrics: { itemHeight: 36 },
    });
    const ghost = projectCalendarChipStyle({
      item: { accent: "#89b4fa", isGhost: true },
      selected: false,
      active: false,
    });

    expect(selected.height).toBe(36);
    expect(selected.color).toBe("#f6f7fb");
    expect(String(selected.background)).toContain("linear-gradient");
    expect(ghost.pointerEvents).toBe("none");
    expect(String(ghost.border)).toContain("dotted");
  });
});
