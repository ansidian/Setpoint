import { createElement } from "react";
import { Sparkles } from "lucide-react";
import { resolveIcon } from "./icons";
import type { ReactNode } from "react";
import type { LucideProps } from "lucide-react";

export interface IconProps extends Omit<LucideProps, "ref" | "name"> {
  name?: unknown;
  fallback?: ReactNode;
}

// Universal renderer: accepts a lucide name or a known emoji. Unknown inputs
// render as Sparkles so historical emoji data from briefings never leaks
// through visually. Pass `fallback` to override (e.g., `fallback={null}` to
// render nothing, or a custom element). Uses createElement so the dynamic
// lookup doesn't trip the react-hooks/static-components rule.
export function Icon({ name, size = 16, className, style, strokeWidth, color, fallback }: IconProps) {
  const Cmp = resolveIcon(name);
  if (Cmp) {
    return createElement(Cmp, { size, className, style, strokeWidth, color });
  }
  if (fallback !== undefined) return fallback;
  return createElement(Sparkles, { size, className, style, strokeWidth, color });
}
