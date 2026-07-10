import { describe, expect, it } from "vitest";
import { resolveDeadlineChipMetrics } from "./DeadlinesCellContent.jsx";

describe("resolveDeadlineChipMetrics identity cache (PERF-01)", () => {
  it("returns the referentially-same metrics object for the same layout object", () => {
    const layout = { tier: "lg" };
    const first = resolveDeadlineChipMetrics(layout);
    const second = resolveDeadlineChipMetrics(layout);
    expect(second).toBe(first);
  });

  it("returns a different metrics object for a different layout object, even with identical values", () => {
    const layoutA = { tier: "lg" };
    const layoutB = { tier: "lg" };
    const metricsA = resolveDeadlineChipMetrics(layoutA);
    const metricsB = resolveDeadlineChipMetrics(layoutB);
    expect(metricsB).not.toBe(metricsA);
    expect(metricsB).toEqual(metricsA);
  });

  it("returns different metrics content for different layout tiers", () => {
    const lg = resolveDeadlineChipMetrics({ tier: "lg" });
    const md = resolveDeadlineChipMetrics({ tier: "md" });
    expect(lg).not.toEqual(md);
  });

  it("does not throw for a missing layout", () => {
    expect(() => resolveDeadlineChipMetrics(undefined)).not.toThrow();
  });
});
