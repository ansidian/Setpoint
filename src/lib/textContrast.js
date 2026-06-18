// WCAG contrast for the canonical readable-text tiers. Alpha colors are composited over
// --background first; reduced opacity is how this UI de-emphasizes text and exactly where
// the ratio collapses. Decorative (<4.5:1) color is NOT listed — non-text use only.
export const BACKGROUND = "#1f1d2b"; // sRGB of --background oklch(0.2155 0.0254 284.0647)
export const READABLE_TEXT = {
  primary: "#cdd6f4",             // --foreground (12.14:1)
  muted: "#a6adc8",               // --color-text-muted (7.89:1)
  faint: "rgba(205,214,244,0.6)", // --color-text-faint (5.13:1) — quietest readable
};
function parse(c) {
  const m = c.trim().match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  const h = c.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
}
function over(fg, bg) {
  const [r, g, b, a] = parse(fg); const [br, bg_, bb] = parse(bg);
  return [r * a + br * (1 - a), g * a + bg_ * (1 - a), b * a + bb * (1 - a)];
}
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrastRatio(fg, bg) {
  const L1 = lum(over(fg, bg)), L2 = lum(parse(bg));
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
