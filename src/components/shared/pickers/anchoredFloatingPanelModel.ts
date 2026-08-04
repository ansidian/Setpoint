export function resolveMobileSheetHeight(
  height: number | string | undefined,
  mobileHeight: string | null | undefined,
): string | undefined {
  if (mobileHeight === null) return undefined;
  if (mobileHeight !== undefined) return mobileHeight;
  return typeof height === "number" ? `min(${height}px, 70vh)` : height;
}
