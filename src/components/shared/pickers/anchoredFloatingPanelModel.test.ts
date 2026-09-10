import { describe, expect, it } from "vitest";
import { resolveContentPlacement } from "./anchoredFloatingPanelModel";

describe("content-aware placement", () => {
  const anchor = { left: 200, right: 500, top: 200, bottom: 220 };
  it("stays beside the selected text when clear", () => {
    expect(resolveContentPlacement(anchor, [anchor], 360, 250, 1400, 900))
      .toEqual({ left: 512, top: 200 });
  });
  it("offsets past nearby longer text without moving to the list edge", () => {
    const below = { left: 200, right: 560, top: 250, bottom: 275 };
    expect(resolveContentPlacement(anchor, [anchor, below], 360, 250, 1400, 900))
      .toEqual({ left: 572, top: 200 });
  });
  it("allows overlap rather than moving far away", () => {
    const below = { left: 200, right: 1200, top: 230, bottom: 800 };
    const result = resolveContentPlacement(anchor, [anchor, below], 360, 250, 1400, 900);
    expect(Math.hypot(result.left - 512, result.top - 200)).toBeLessThanOrEqual(120);
  });
  it("uses the left side and clamps vertically near viewport edges", () => {
    expect(resolveContentPlacement({ left: 1000, right: 1200, top: 850, bottom: 870 }, [], 360, 250, 1400, 900))
      .toEqual({ left: 628, top: 640 });
  });
});
