import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type PortalRef = RefObject<HTMLElement | null>;

interface UseDismissablePortalOptions {
  ref?: PortalRef;
  refs?: PortalRef[];
  ignoreSelector?: string;
  active: boolean;
  onDismiss?: () => void;
  onTabKey?: (event: KeyboardEvent) => void;
  onActivate?: () => void;
  activateKey?: unknown;
}

type PortalHandlers = Omit<UseDismissablePortalOptions, "active" | "activateKey">;

// Shared dismiss/focus machinery for body-portal menus, popovers, and anchored
// panels. While the panel is open it closes on an outside pointerdown and on
// Escape (Escape is handled in the capture phase so it wins over inner handlers),
// optionally contains Tab focus, and optionally moves focus into the panel when
// it opens.
//
// Extracted from CalendarQuickActionLayer's context menu + scope prompt; also
// the dismiss primitive for the deadline quick-action menu and the shared
// AnchoredFloatingPanel (see AGENTS.md "Floating Panel Pattern").
//
// Params:
// - ref / refs: the element(s) that count as "inside". An outside pointerdown is
//   one whose target none of these contain. Pass a single `ref` OR an array of
//   `refs` (e.g. a panel plus its anchor). At least one is required.
// - ignoreSelector: optional CSS selector; a pointerdown whose target matches
//   `closest(ignoreSelector)` is treated as inside. Used as a cross-panel escape
//   hatch (e.g. clicking another calendar popover should not dismiss this one).
// - active: whether the panel is open. Listeners bind only while true.
// - onDismiss: called for both an outside pointerdown and Escape.
// - onTabKey: optional Tab handler (e.g. focus containment); receives the event.
//   When omitted, Tab is left alone.
// - onActivate: optional callback run via queueMicrotask after the panel opens
//   (e.g. autofocus). Re-runs whenever activateKey changes so focus can follow
//   state transitions (e.g. entering a confirm step).
// - activateKey: value that retriggers onActivate when it changes.
//
// Callbacks and refs are read through a ref so the document listeners bind once
// per open session (not on every render) while always invoking the latest
// closures — this keeps a freshly-built `refs` array each render from rebinding.
export default function useDismissablePortal({
  ref,
  refs,
  ignoreSelector,
  active,
  onDismiss,
  onTabKey,
  onActivate,
  activateKey,
}: UseDismissablePortalOptions): void {
  const handlersRef = useRef<PortalHandlers>({});
  useEffect(() => {
    handlersRef.current = { ref, refs, ignoreSelector, onDismiss, onTabKey, onActivate };
  });

  useEffect(() => {
    if (!active) return undefined;
    function handlePointerDown(event: PointerEvent) {
      const { ref, refs, ignoreSelector } = handlersRef.current;
      const insideRefs = refs ?? (ref ? [ref] : []);
      for (const candidate of insideRefs) {
        if (event.target instanceof Node && candidate?.current?.contains(event.target)) return;
      }
      if (ignoreSelector && event.target instanceof Element && event.target.closest(ignoreSelector)) return;
      handlersRef.current.onDismiss?.();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        handlersRef.current.onTabKey?.(event);
        return;
      }
      if (event.key === "Escape") {
        handlersRef.current.onDismiss?.();
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (!handlersRef.current.onActivate) return;
    window.queueMicrotask(() => handlersRef.current.onActivate?.());
  }, [active, activateKey]);
}
