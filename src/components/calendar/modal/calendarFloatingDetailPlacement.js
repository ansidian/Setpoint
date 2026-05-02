const VIEWPORT_PADDING = 16;
const PANEL_GAP = 12;
const PARKING_INSET = 12;
const DEFAULT_PANEL_WIDTH = 380;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 400;
const DEFAULT_EDITOR_WIDTH = 420;
const MIN_EDITOR_WIDTH = 360;
const MAX_EDITOR_WIDTH = 520;
const DEFAULT_PANEL_HEIGHT = 300;
const MIN_PANEL_HEIGHT = 180;
const MAX_PANEL_HEIGHT = 560;
const MAX_EDITOR_HEIGHT = 720;

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function rectIntersects(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function normalizedBounds(calendarRect) {
  if (calendarRect) {
    return {
      top: calendarRect.top + VIEWPORT_PADDING,
      right: calendarRect.right - VIEWPORT_PADDING,
      bottom: calendarRect.bottom - VIEWPORT_PADDING,
      left: calendarRect.left + VIEWPORT_PADDING,
      width: Math.max(0, calendarRect.width - VIEWPORT_PADDING * 2),
      height: Math.max(0, calendarRect.height - VIEWPORT_PADDING * 2),
    };
  }

  return {
    top: VIEWPORT_PADDING,
    right: window.innerWidth - VIEWPORT_PADDING,
    bottom: window.innerHeight - VIEWPORT_PADDING,
    left: VIEWPORT_PADDING,
    width: Math.max(0, window.innerWidth - VIEWPORT_PADDING * 2),
    height: Math.max(0, window.innerHeight - VIEWPORT_PADDING * 2),
  };
}

function panelRect({ left, top, width, height }) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
}

function candidateScore(candidate, exclusions) {
  const rect = panelRect(candidate);
  const overlap = exclusions.reduce((sum, exclusion) => sum + overlapArea(rect, exclusion), 0);
  const overflow = Math.max(0, candidate.bounds.left - rect.left)
    + Math.max(0, rect.right - candidate.bounds.right)
    + Math.max(0, candidate.bounds.top - rect.top)
    + Math.max(0, rect.bottom - candidate.bounds.bottom);
  return overlap * 10 + overflow;
}

export function resolveFloatingDetailPlacement({
  anchorRect,
  sourceRect,
  exclusionRect,
  calendarRect,
  railRect,
  panelHeight,
  mode = "detail",
  parked = false,
  preferredSide = null,
  forcedSide = null,
  allowRailOverlap = false,
}) {
  const bounds = normalizedBounds(calendarRect);
  const isEditor = mode === "edit" || mode === "create";
  const width = isEditor
    ? clamp(DEFAULT_EDITOR_WIDTH, Math.min(MIN_EDITOR_WIDTH, bounds.width), Math.min(MAX_EDITOR_WIDTH, bounds.width))
    : clamp(DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, bounds.width));
  const maxHeight = isEditor
    ? clamp(Math.min(MAX_EDITOR_HEIGHT, bounds.height), Math.min(420, bounds.height), MAX_EDITOR_HEIGHT)
    : clamp(Math.min(MAX_PANEL_HEIGHT, bounds.height), MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT);
  const height = clamp(panelHeight || (isEditor ? 560 : DEFAULT_PANEL_HEIGHT), MIN_PANEL_HEIGHT, maxHeight);

  if (parked) {
    const parkingRect = railRect || calendarRect || bounds;
    const parkingWidth = isEditor
      ? clamp(width, Math.min(MIN_EDITOR_WIDTH, bounds.width), Math.min(MAX_EDITOR_WIDTH, bounds.width))
      : clamp(
          DEFAULT_PANEL_WIDTH,
          MIN_PANEL_WIDTH,
          Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, (parkingRect.width || width) - PARKING_INSET * 2)),
        );
    const left = clamp(
      (parkingRect.left ?? bounds.right - parkingWidth - PARKING_INSET) + PARKING_INSET,
      bounds.left,
      bounds.right - parkingWidth,
    );
    const top = clamp(
      (parkingRect.top ?? bounds.top) + PARKING_INSET,
      bounds.top,
      bounds.bottom - height,
    );

    return {
      top,
      left,
      width: parkingWidth,
      maxHeight,
      caretSide: null,
      caretTop: 0,
    };
  }

  const referenceRect = sourceRect || anchorRect;
  const caretRect = anchorRect || referenceRect;
  if (!referenceRect || !caretRect) {
    return {
      top: bounds.top,
      left: clamp(bounds.right - width, bounds.left, bounds.right - width),
      width,
      maxHeight,
      caretSide: null,
      caretTop: 0,
    };
  }

  const idealTop = caretRect.top + caretRect.height / 2 - height / 2;
  const top = clamp(idealTop, bounds.top, bounds.bottom - height);
  const railExclusion = allowRailOverlap ? null : railRect;
  const exclusions = [sourceRect, exclusionRect, railExclusion].filter(Boolean);
  const rightCandidate = {
    side: "right",
    top,
    left: clamp(referenceRect.right + PANEL_GAP, bounds.left, bounds.right - width),
    width,
    height,
    bounds,
  };
  const leftCandidate = {
    side: "left",
    top,
    left: clamp(referenceRect.left - width - PANEL_GAP, bounds.left, bounds.right - width),
    width,
    height,
    bounds,
  };
  const rightClear = rightCandidate.left >= referenceRect.right + PANEL_GAP - 1
    && !exclusions.some((rect) => rectIntersects(panelRect(rightCandidate), rect));
  const leftClear = leftCandidate.left + width <= referenceRect.left - PANEL_GAP + 1
    && !exclusions.some((rect) => rectIntersects(panelRect(leftCandidate), rect));
  let selected = null;
  if (forcedSide === "left" && allowRailOverlap) {
    selected = leftCandidate;
  } else if (forcedSide === "right" && allowRailOverlap) {
    selected = rightCandidate;
  } else if ((forcedSide || preferredSide) === "left" && leftClear) {
    selected = leftCandidate;
  } else if ((forcedSide || preferredSide) === "right" && rightClear) {
    selected = rightCandidate;
  } else if (rightClear) {
    selected = rightCandidate;
  } else if (leftClear) {
    selected = leftCandidate;
  } else {
    selected = candidateScore(rightCandidate, exclusions) <= candidateScore(leftCandidate, exclusions)
      ? rightCandidate
      : leftCandidate;
  }

  return {
    top: selected.top,
    left: selected.left,
    width,
    maxHeight,
    caretSide: selected.side === "right" ? "left" : "right",
    caretTop: clamp(caretRect.top + caretRect.height / 2 - selected.top - 6, 18, height - 18),
  };
}

export function isRectInside(inner, outer) {
  if (!inner || !outer) return false;
  return inner.bottom > outer.top && inner.top < outer.bottom && inner.right > outer.left && inner.left < outer.right;
}

export function clampFloatingPosition(position, size, calendarRect) {
  const bounds = normalizedBounds(calendarRect);
  const width = size?.width || DEFAULT_PANEL_WIDTH;
  const height = Math.min(size?.height || DEFAULT_PANEL_HEIGHT, size?.maxHeight || MAX_PANEL_HEIGHT);
  return {
    left: clamp(position.left, bounds.left, bounds.right - width),
    top: clamp(position.top, bounds.top, bounds.bottom - height),
  };
}
