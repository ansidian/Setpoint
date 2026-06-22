import { describe, expect, it } from "vitest";
import {
  isAwaitingMeasuredPlacement,
  isInstantPlacementTransition,
  isManualTransitionActive,
  isSnapTransitionActive,
  resolveAnchoredPlacement,
  resolveRenderPlacement,
  samePlacement,
} from "./calendarFloatingDetailRevealModel.js";

const placement = (overrides = {}) => ({
  top: 100,
  left: 200,
  width: 380,
  maxHeight: 520,
  caretSide: "left",
  caretTop: 40,
  ...overrides,
});

describe("samePlacement", () => {
  it("treats sub-pixel differences within the same integer as equal", () => {
    expect(samePlacement(placement({ top: 100.2 }), placement({ top: 100.4 }))).toBe(true);
  });

  it("treats an integer-pixel difference as a move", () => {
    expect(samePlacement(placement({ top: 100 }), placement({ top: 101 }))).toBe(false);
  });

  it("distinguishes a caret side flip even at the same coordinates", () => {
    expect(samePlacement(placement({ caretSide: "left" }), placement({ caretSide: "right" }))).toBe(false);
  });

  it("is falsy when either side is missing", () => {
    // Mirrors the original `a && b && ...`: returns the falsy operand, used in a
    // boolean context by the caller — not coerced to a strict `false`.
    expect(samePlacement(null, placement())).toBeFalsy();
    expect(samePlacement(placement(), null)).toBeFalsy();
  });
});

describe("resolveAnchoredPlacement", () => {
  it("returns the resolved placement when present", () => {
    const p = placement();
    expect(resolveAnchoredPlacement(p, { width: 999, maxHeight: 999 })).toBe(p);
  });

  it("falls back to a top-left box sized from the measured size when no placement", () => {
    expect(resolveAnchoredPlacement(null, { width: 360, maxHeight: 480 })).toEqual({
      top: 24,
      left: 24,
      width: 360,
      maxHeight: 480,
      caretSide: null,
      caretTop: 0,
    });
  });
});

describe("resolveRenderPlacement", () => {
  it("overrides position and drops the caret while a manual position owns the panel", () => {
    const anchored = placement();
    const result = resolveRenderPlacement(anchored, {
      manualPlacementActive: true,
      manualPosition: { top: 10, left: 20 },
    });
    expect(result).toMatchObject({ top: 10, left: 20, caretSide: null, caretTop: 0, width: 380 });
  });

  it("passes the anchored placement through untouched when no manual position is active", () => {
    const anchored = placement();
    expect(resolveRenderPlacement(anchored, { manualPlacementActive: false, manualPosition: null })).toBe(anchored);
  });

  it("does not dereference a null manual position even if the active flag is set (closed-panel render)", () => {
    const anchored = placement();
    expect(resolveRenderPlacement(anchored, { manualPlacementActive: true, manualPosition: null })).toBe(anchored);
  });
});

describe("isManualTransitionActive", () => {
  it("is true if a manual position is active, a drag is in progress, or the panel was user-dragged", () => {
    expect(isManualTransitionActive({ manualPlacementActive: true, dragging: false, manualDragActive: false })).toBe(true);
    expect(isManualTransitionActive({ manualPlacementActive: false, dragging: true, manualDragActive: false })).toBe(true);
    expect(isManualTransitionActive({ manualPlacementActive: false, dragging: false, manualDragActive: true })).toBe(true);
    expect(isManualTransitionActive({ manualPlacementActive: false, dragging: false, manualDragActive: false })).toBe(false);
  });
});

describe("isSnapTransitionActive", () => {
  const base = {
    snapPlacementKey: "k1",
    placementKey: "k1",
    snapPlacementIntent: "auto",
    sideIntent: "auto",
    hasRevealedMeasuredPlacement: false,
  };

  it("is false when the snap key does not match the current placement key", () => {
    expect(isSnapTransitionActive({ ...base, snapPlacementKey: "other" })).toBe(false);
  });

  it("snaps a matching key on the first reveal (auto intent, not yet revealed)", () => {
    expect(isSnapTransitionActive(base)).toBe(true);
  });

  it("still snaps a revealed panel when the side was not user-flipped (auto reposition)", () => {
    // Pins the `sideIntent === "user-flip"` half of the guard: once revealed, only
    // a user-flip side should animate; an auto reposition still snaps.
    expect(isSnapTransitionActive({
      ...base,
      snapPlacementIntent: "auto",
      sideIntent: "auto",
      hasRevealedMeasuredPlacement: true,
    })).toBe(true);
  });

  it("always snaps an explicit user-flip intent", () => {
    expect(isSnapTransitionActive({
      ...base,
      snapPlacementIntent: "user-flip",
      sideIntent: "user-flip",
      hasRevealedMeasuredPlacement: true,
    })).toBe(true);
  });

  it("does NOT reuse the first-reveal snap for a user flip once the panel is already revealed", () => {
    // sideIntent user-flip + already revealed + snap intent NOT user-flip => animate, don't snap.
    expect(isSnapTransitionActive({
      ...base,
      snapPlacementIntent: "auto",
      sideIntent: "user-flip",
      hasRevealedMeasuredPlacement: true,
    })).toBe(false);
  });
});

describe("isAwaitingMeasuredPlacement", () => {
  const base = {
    open: true,
    placementKey: "k1",
    resizeObserverAvailable: true,
    manualPlacementActive: false,
    hasRevealedMeasuredPlacement: false,
    measuredPlacementKey: null,
  };

  it("holds the panel hidden before its first measurement for this key", () => {
    expect(isAwaitingMeasuredPlacement(base)).toBe(true);
  });

  it("reveals once this key has been measured", () => {
    expect(isAwaitingMeasuredPlacement({ ...base, measuredPlacementKey: "k1" })).toBe(false);
  });

  it("reveals once any placement has been revealed", () => {
    expect(isAwaitingMeasuredPlacement({ ...base, hasRevealedMeasuredPlacement: true })).toBe(false);
  });

  it("does not await when the panel is closed", () => {
    expect(isAwaitingMeasuredPlacement({ ...base, open: false })).toBe(false);
  });

  it("does not await without a placement key", () => {
    expect(isAwaitingMeasuredPlacement({ ...base, placementKey: null })).toBe(false);
  });

  it("does not await when ResizeObserver is unavailable (it would never measure)", () => {
    expect(isAwaitingMeasuredPlacement({ ...base, resizeObserverAvailable: false })).toBe(false);
  });

  it("does not await while a manual drag position owns the panel", () => {
    expect(isAwaitingMeasuredPlacement({ ...base, manualPlacementActive: true })).toBe(false);
  });
});

describe("isInstantPlacementTransition", () => {
  it("skips the spring for manual, snap, or pre-reveal transitions", () => {
    expect(isInstantPlacementTransition({ manualTransitionActive: true, snapTransitionActive: false, awaitingMeasuredPlacement: false })).toBe(true);
    expect(isInstantPlacementTransition({ manualTransitionActive: false, snapTransitionActive: true, awaitingMeasuredPlacement: false })).toBe(true);
    expect(isInstantPlacementTransition({ manualTransitionActive: false, snapTransitionActive: false, awaitingMeasuredPlacement: true })).toBe(true);
    expect(isInstantPlacementTransition({ manualTransitionActive: false, snapTransitionActive: false, awaitingMeasuredPlacement: false })).toBe(false);
  });
});
