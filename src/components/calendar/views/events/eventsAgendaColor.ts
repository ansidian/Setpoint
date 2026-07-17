export function colorWithAlpha(color: unknown, alpha: number): string {
  if (typeof color !== "string" || !color.startsWith("#") || color.length !== 7) return `rgba(137,180,250,${alpha})`;
  const value = Number.parseInt(color.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function contrastText(hex: unknown): string {
  if (typeof hex !== "string" || !hex.startsWith("#") || hex.length !== 7) return "#cdd6f4";
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.52 ? "#16161e" : "#f5f6ff";
}
