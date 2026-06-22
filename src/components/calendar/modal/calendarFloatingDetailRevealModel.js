// Pure reveal/snap decision rules for the floating detail panel, extracted from
// CalendarFloatingDetailPanel's render body (which had no pure-model test). These
// decide three things the Motion shell animates on:
//   - resolvedPlacement: anchored placement, overridden by a manual drag position
//   - awaitingMeasuredPlacement: keep the panel invisible until its first measured
//     placement so it never animates through the rail before the side flip resolves
//   - instantPlacementTransition: skip the spring (duration 0.01) for manual drags,
//     cold side-flip snaps, and the pre-reveal placement jump
// Each is a pure function of render-time inputs so the gating truth table is
// unit-testable without a DOM or Motion.

// Placement equality at integer-pixel granularity — used to avoid restating
// placement (and re-rendering the grid) when a recompute lands on the same spot.
export function samePlacement(a, b) {
  return a
    && b
    && Math.round(a.top) === Math.round(b.top)
    && Math.round(a.left) === Math.round(b.left)
    && Math.round(a.width) === Math.round(b.width)
    && Math.round(a.maxHeight) === Math.round(b.maxHeight)
    && Math.round(a.caretTop || 0) === Math.round(b.caretTop || 0)
    && a.caretSide === b.caretSide;
}

// The fallback box used until an anchored placement resolves (top-left corner).
export function resolveAnchoredPlacement(placement, measuredSize) {
  return placement || {
    top: 24,
    left: 24,
    width: measuredSize.width,
    maxHeight: measuredSize.maxHeight,
    caretSide: null,
    caretTop: 0,
  };
}

// When a manual drag owns the position, override top/left and drop the caret.
// `manualPosition` is guarded because the hosting hook computes this every render
// (even while the panel is closed, before the component's open-gate), where a null
// placement key can make `manualPlacementActive` true with no manual position yet.
export function resolveRenderPlacement(anchoredPlacement, { manualPlacementActive, manualPosition }) {
  return manualPlacementActive && manualPosition
    ? {
        ...anchoredPlacement,
        top: manualPosition.top,
        left: manualPosition.left,
        caretSide: null,
        caretTop: 0,
      }
    : anchoredPlacement;
}

export function isManualTransitionActive({ manualPlacementActive, dragging, manualDragActive }) {
  return manualPlacementActive || dragging || manualDragActive;
}

// A cold side flip (or the first reveal) snaps instantly; once the panel has
// revealed a user-flipped side, subsequent flips animate.
export function isSnapTransitionActive({
  snapPlacementKey,
  placementKey,
  snapPlacementIntent,
  sideIntent,
  hasRevealedMeasuredPlacement,
}) {
  return snapPlacementKey === placementKey
    && (snapPlacementIntent === "user-flip"
      || !(sideIntent === "user-flip" && hasRevealedMeasuredPlacement));
}

// Hold the panel hidden until its first measured placement for this key.
export function isAwaitingMeasuredPlacement({
  open,
  placementKey,
  resizeObserverAvailable,
  manualPlacementActive,
  hasRevealedMeasuredPlacement,
  measuredPlacementKey,
}) {
  return open
    && !!placementKey
    && resizeObserverAvailable
    && !manualPlacementActive
    && !hasRevealedMeasuredPlacement
    && measuredPlacementKey !== placementKey;
}

export function isInstantPlacementTransition({
  manualTransitionActive,
  snapTransitionActive,
  awaitingMeasuredPlacement,
}) {
  return manualTransitionActive || snapTransitionActive || awaitingMeasuredPlacement;
}
