export interface OverflowPopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveOverflowPopoverPosition(triggerElement: Element | null | undefined): OverflowPopoverPosition {
  const viewportPadding = 16;
  const width = Math.min(320, window.innerWidth - viewportPadding * 2);
  const maxHeight = Math.min(320, Math.max(160, window.innerHeight - viewportPadding * 2));

  if (!triggerElement?.isConnected) {
    return { top: viewportPadding, left: viewportPadding, width, maxHeight };
  }

  const rect = triggerElement.getBoundingClientRect();
  const left = clamp(rect.left, viewportPadding, window.innerWidth - width - viewportPadding);
  const belowTop = rect.bottom + 8;
  const aboveTop = rect.top - maxHeight - 8;
  const lowerBound = Math.max(viewportPadding, window.innerHeight - maxHeight - viewportPadding);
  const top = belowTop + maxHeight <= window.innerHeight - viewportPadding
    ? belowTop
    : aboveTop >= viewportPadding
      ? aboveTop
      : clamp(belowTop, viewportPadding, lowerBound);
  return { top, left, width, maxHeight };
}
