import { describe, expect, it } from "vitest";
import {
  clampFloatingPosition,
  resolveFloatingDetailPlacement,
} from "./calendarFloatingDetailPlacement.js";

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

describe("clampFloatingPosition", () => {
  const size = { width: 380, height: 300, maxHeight: 520 };

  // P3-12: the drag clamp must follow the calendar rect it is given. The panel
  // re-reads the LIVE calendar rect each rAF-throttled move, so a mid-drag
  // viewport/layout change must produce a different clamped result for the same
  // drag position — clamping against a wider stale rect would let the panel
  // escape the shrunken calendar bounds.
  it("clamps the same drag position differently as the calendar rect changes", () => {
    const position = { left: 1000, top: 300 };

    // Wide calendar: bounds.right = 1200 - 16 = 1184, max left = 1184 - 380 = 804.
    const wide = clampFloatingPosition(position, size, {
      left: 0,
      top: 0,
      right: 1200,
      bottom: 720,
      width: 1200,
      height: 720,
    });
    expect(wide.left).toBe(804);

    // Same drag point, narrower calendar: bounds.right = 900 - 16 = 884,
    // max left = 884 - 380 = 504. A stale wide rect would have allowed 804.
    const narrow = clampFloatingPosition(position, size, {
      left: 0,
      top: 0,
      right: 900,
      bottom: 720,
      width: 900,
      height: 720,
    });
    expect(narrow.left).toBe(504);
    expect(narrow.left).toBeLessThan(wide.left);
  });
});
