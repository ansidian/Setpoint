import { describe, expect, it } from "vitest";
import { resolveFloatingDetailPlacement } from "./calendarFloatingDetailPlacement.js";

function rect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

describe("resolveFloatingDetailPlacement", () => {
  it("flips anchored detail panels away from the rail", () => {
    const railRect = rect(900, 60, 280, 620);
    const sourceRect = rect(620, 180, 60, 80);
    const placement = resolveFloatingDetailPlacement({
      anchorRect: rect(640, 200, 32, 28),
      sourceRect,
      calendarRect: rect(0, 0, 1200, 720),
      railRect,
      panelHeight: 300,
      mode: "detail",
    });

    expect(placement.caretSide).toBe("right");
    expect(placement.left + placement.width).toBeLessThanOrEqual(railRect.left);
  });

  it("honors a forced side while clamping inside calendar bounds", () => {
    const railRect = rect(900, 60, 280, 620);
    const placement = resolveFloatingDetailPlacement({
      anchorRect: rect(640, 200, 32, 28),
      sourceRect: rect(620, 180, 60, 80),
      calendarRect: rect(0, 0, 1200, 720),
      railRect,
      panelHeight: 300,
      mode: "detail",
      forcedSide: "right",
      allowRailOverlap: true,
    });

    expect(placement.caretSide).toBe("left");
    expect(placement.left + placement.width).toBeLessThanOrEqual(1200 - 16);
    expect(placement.left + placement.width).toBeGreaterThan(railRect.left);
  });

  it("treats a forced side as a preference unless rail overlap is explicitly allowed", () => {
    const railRect = rect(900, 60, 280, 620);
    const placement = resolveFloatingDetailPlacement({
      anchorRect: rect(640, 200, 32, 28),
      sourceRect: rect(620, 180, 60, 80),
      calendarRect: rect(0, 0, 1200, 720),
      railRect,
      panelHeight: 300,
      mode: "detail",
      forcedSide: "right",
      allowRailOverlap: false,
    });

    expect(placement.caretSide).toBe("right");
    expect(placement.left + placement.width).toBeLessThanOrEqual(railRect.left);
  });

  it("uses a compact editor width so the month grid remains visible", () => {
    const placement = resolveFloatingDetailPlacement({
      anchorRect: rect(640, 200, 32, 28),
      sourceRect: rect(620, 180, 60, 80),
      calendarRect: rect(0, 0, 1200, 720),
      railRect: rect(900, 60, 280, 620),
      panelHeight: 300,
      mode: "create",
    });

    expect(placement.width).toBe(420);
  });

  it("clamps compact editor width between mobile-safe and desktop maximum bounds", () => {
    const narrowPlacement = resolveFloatingDetailPlacement({
      calendarRect: rect(0, 0, 380, 720),
      panelHeight: 300,
      mode: "edit",
    });
    const widePlacement = resolveFloatingDetailPlacement({
      calendarRect: rect(0, 0, 2200, 1200),
      panelHeight: 300,
      mode: "edit",
    });

    expect(narrowPlacement.width).toBe(348);
    expect(widePlacement.width).toBe(420);
  });
});
