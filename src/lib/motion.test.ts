import { describe, expect, it } from "vitest";
import { createHeightMotionBudget } from "./motion";

describe("continuous height resize budget", () => {
  it("keeps retargets and reversals within one 250ms deadline", () => {
    const duration = createHeightMotionBudget();
    expect(duration(1000)).toBe(0.16);
    for (let time = 1030; time <= 1480; time += 30) {
      expect(time + duration(time) * 1000).toBeLessThanOrEqual(Math.max(time, 1250));
    }
    expect(duration(1500)).toBe(0);
  });

  it("starts a fresh budget after resizing has been quiet", () => {
    const duration = createHeightMotionBudget();
    duration(0);
    duration(100);
    expect(duration(200)).toBeCloseTo(0.05);
    expect(duration(400)).toBe(0.16);
  });

  it("follows animated descendants through the final unmarked measurement", () => {
    const duration = createHeightMotionBudget();
    expect(duration(0)).toBe(0.16);
    expect(duration(16, true)).toBe(0);
    expect(duration(100, true)).toBe(0);
    expect(duration(176, false)).toBe(0);
    expect(duration(400, false)).toBe(0.16);
  });
});
