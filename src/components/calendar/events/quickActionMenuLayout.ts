// DOM measurement + focus mechanics for the calendar quick-action context menu
// (viewport-clamped fixed positioning + roving/tab-contained focus over the menu
// or its color dots). Extracted from CalendarQuickActionLayer; the focus helpers
// are consumed by the menu's useDismissablePortal wiring.

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface QuickActionMenuPosition {
  x: number;
  y: number;
}

export interface QuickActionMenuClampOptions extends QuickActionMenuPosition {
  width?: number;
  padding?: number;
  bottomReserve: number;
}

export type QuickActionItemResolver = (container: ParentNode | null) => HTMLElement[];

// Clamp a fixed-position menu anchored at {x, y} inside the viewport. `width`
// reserves room on the right edge; `bottomReserve` reserves room below the
// anchor so the menu doesn't overflow the bottom edge. Shared by the calendar
// event quick-action menu and the deadline quick-action menu, which differ only
// in how much bottom room they reserve.
export function clampMenuPosition({ x, y, width = 220, padding = 12, bottomReserve }: QuickActionMenuClampOptions) {
  const left = Math.min(
    Math.max(padding, x),
    Math.max(padding, window.innerWidth - width - padding),
  );
  const top = Math.min(
    Math.max(padding, y),
    Math.max(padding, window.innerHeight - bottomReserve),
  );
  return { left, top, width };
}

// Clamp a 220px fixed menu anchored at {x, y} inside the viewport (reserves the
// menu's own 220px height + 12px padding, i.e. 232px, below the anchor).
export function menuStyle(menu: QuickActionMenuPosition) {
  return clampMenuPosition({ x: menu.x, y: menu.y, bottomReserve: 232 });
}

export function focusableItems(container: ParentNode | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function focusFirstMenuItem(container: ParentNode | null) {
  focusableItems(container)[0]?.focus({ preventScroll: true });
}

export function colorDotItems(container: ParentNode | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>("[data-calendar-event-color-button='true']:not(:disabled)"));
}

export function contextMenuFocusItems(container: ParentNode | null) {
  const dots = colorDotItems(container);
  return dots.length ? dots : focusableItems(container);
}

export function focusMenuColor(container: ParentNode | null) {
  const dots = colorDotItems(container);
  if (!dots.length) {
    focusFirstMenuItem(container);
    return;
  }
  const selected = dots.find((element) => element.getAttribute("aria-pressed") === "true");
  (selected || dots[0])?.focus({ preventScroll: true });
}

export function containTabFocus(
  event: Pick<KeyboardEvent, "preventDefault" | "shiftKey">,
  container: ParentNode | null,
  itemResolver: QuickActionItemResolver = focusableItems,
) {
  const items = itemResolver(container);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;

  if (!active || !items.includes(active as HTMLElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus({ preventScroll: true });
    return;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last?.focus({ preventScroll: true });
    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus({ preventScroll: true });
  }
}
