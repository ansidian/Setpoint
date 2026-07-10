import { describe, expect, it } from "vitest";
import { resolveEventChipMetrics } from "./EventsCellContent.jsx";

describe("resolveEventChipMetrics identity cache (PERF-01)", () => {
  it("returns the referentially-same metrics object for the same layout object", () => {
    const layout = { tier: "lg" };
    const first = resolveEventChipMetrics(layout);
    const second = resolveEventChipMetrics(layout);
    expect(second).toBe(first);
  });

  it("returns a different metrics object for a different layout object, even with identical values", () => {
    const layoutA = { tier: "lg" };
    const layoutB = { tier: "lg" };
    const metricsA = resolveEventChipMetrics(layoutA);
    const metricsB = resolveEventChipMetrics(layoutB);
    expect(metricsB).not.toBe(metricsA);
    expect(metricsB).toEqual(metricsA);
  });

  it("returns different metrics content for different layout tiers", () => {
    const lg = resolveEventChipMetrics({ tier: "lg" });
    const md = resolveEventChipMetrics({ tier: "md" });
    expect(lg).not.toEqual(md);
  });

  it("does not throw for a missing layout", () => {
    expect(() => resolveEventChipMetrics(undefined)).not.toThrow();
  });
});
