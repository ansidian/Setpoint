import { describe, expect, it } from "vitest";
import { resolveAnalyticsSnapshotScale } from "./analyticsBackdropSnapshot.js";

describe("resolveAnalyticsSnapshotScale", () => {
  it("caps large 4K captures so blur work stays bounded", () => {
    expect(resolveAnalyticsSnapshotScale({ width: 3840, height: 2160 })).toBeCloseTo(0.4167, 4);
  });

  it("keeps ordinary laptop captures low enough for a blurred backdrop", () => {
    expect(resolveAnalyticsSnapshotScale({ width: 1512, height: 982 })).toBe(0.55);
  });

  it("does not shrink tiny captures below the minimum useful scale", () => {
    expect(resolveAnalyticsSnapshotScale({ width: 10000, height: 6000 })).toBe(0.25);
  });
});
