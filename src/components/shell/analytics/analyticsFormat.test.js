import { describe, expect, it } from "vitest";
import {
  formatUsdEstimate,
  formatPercent,
  formatCompactNumber,
  formatModelName,
} from "./analyticsFormat.js";

describe("formatUsdEstimate", () => {
  it("renders an exact zero as ordinary currency (no sub-cent treatment)", () => {
    expect(formatUsdEstimate(0)).toBe("$0.00");
  });

  it("collapses positive amounts below a hundredth of a cent to a floor label", () => {
    expect(formatUsdEstimate(0.00005)).toBe("<$0.0001");
  });

  it("shows four decimals for sub-cent amounts so tiny costs stay visible", () => {
    expect(formatUsdEstimate(0.005)).toBe("$0.0050");
  });

  it("formats amounts at or above a cent as two-decimal currency", () => {
    expect(formatUsdEstimate(1.2)).toBe("$1.20");
  });
});

describe("formatPercent", () => {
  it("treats NaN as zero rather than emitting 'NaN%'", () => {
    expect(formatPercent(NaN)).toBe("0.0%");
  });

  it("treats undefined as zero", () => {
    expect(formatPercent(undefined)).toBe("0.0%");
  });

  it("scales a fraction to a one-decimal percentage", () => {
    expect(formatPercent(0.6)).toBe("60.0%");
  });
});

describe("formatCompactNumber", () => {
  it("leaves small counts intact", () => {
    expect(formatCompactNumber(12)).toBe("12");
  });

  it("compacts thousands with a lowercase suffix", () => {
    expect(formatCompactNumber(50000)).toBe("50k");
  });

  it("coerces non-finite input to zero", () => {
    expect(formatCompactNumber(undefined)).toBe("0");
  });
});

describe("formatModelName", () => {
  it("maps a known Claude id to a scannable family + version label", () => {
    expect(formatModelName("claude-sonnet-4-6")).toBe("Sonnet 4.6");
  });

  it("derives the label from the family/version regardless of a date suffix", () => {
    expect(formatModelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("passes an unrecognized id through unchanged", () => {
    expect(formatModelName("gpt-5.4")).toBe("gpt-5.4");
  });

  it("falls back to 'unknown' when no id is supplied", () => {
    expect(formatModelName(null)).toBe("unknown");
  });
});
