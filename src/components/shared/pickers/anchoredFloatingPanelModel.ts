type TextRect = { left: number; right: number; top: number; bottom: number };

// Search near the selected text, allowing overlap rather than a distant panel.
export function resolveContentPlacement(
  anchor: TextRect, text: TextRect[], width: number, height: number,
  viewportWidth: number, viewportHeight: number,
): { left: number; top: number } {
  const gap = 12;
  const clampX = (x: number) => Math.max(10, Math.min(x, viewportWidth - width - 10));
  const clampY = (y: number) => Math.max(10, Math.min(y, viewportHeight - height - 10));
  const rightFits = anchor.right + gap + width <= viewportWidth - 10;
  const preferred = {
    left: clampX(rightFits ? anchor.right + gap : anchor.left - width - gap),
    top: clampY(anchor.top),
  };
  const candidates = [preferred];
  for (const rect of text) {
    candidates.push(
      { left: clampX(rect.right + gap), top: preferred.top },
      { left: clampX(rect.left - width - gap), top: preferred.top },
      { left: preferred.left, top: clampY(rect.bottom + gap) },
      { left: preferred.left, top: clampY(rect.top - height - gap) },
    );
  }
  const score = (point: typeof preferred) => {
    const distance = Math.hypot(point.left - preferred.left, point.top - preferred.top);
    if (distance > 120) return Infinity;
    const overlap = text.reduce((sum, rect) => sum
      + Math.max(0, Math.min(point.left + width, rect.right + 4) - Math.max(point.left, rect.left - 4))
      * Math.max(0, Math.min(point.top + height, rect.bottom + 4) - Math.max(point.top, rect.top - 4)), 0);
    return overlap + distance * 20;
  };
  return candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best, preferred);
}

export function resolveMobileSheetHeight(
  height: number | string | undefined,
  mobileHeight: string | null | undefined,
): string | undefined {
  if (mobileHeight === null) return undefined;
  if (mobileHeight !== undefined) return mobileHeight;
  return typeof height === "number" ? `min(${height}px, 70vh)` : height;
}
