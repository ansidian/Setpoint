// Native HTML5 drag is desktop-only: disabled on the stacked/mobile layout and on
// coarse (touch) pointers, where tap-to-open is the interaction instead.
export function nativeDragSupported(layout) {
  if (layout?.stacked) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(pointer: fine)").matches;
}
