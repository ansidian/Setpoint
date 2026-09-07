import { useLayoutEffect } from "react";

// One modality owner for the app and body portals. Styling changes only:
// shortcuts, native activation, focus order, and programmatic focus stay intact.
export default function useKeyboardFocusIndicators() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-sp-keyboard-focus");
    const setVisible = (visible: boolean) => {
      root.setAttribute("data-sp-keyboard-focus", String(visible));
    };
    setVisible(false);

    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const textEntry = target?.isContentEditable || target?.closest("textarea, [contenteditable='true']")
        || (target instanceof HTMLInputElement
          && !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(target.type));
      const unmodified = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (unmodified && event.key === "Tab") {
        setVisible(true);
        return;
      }
      // Spaces/newlines entered into text fields are typing, not activation.
      if (textEntry) return;
      if (unmodified && ["Enter", " "].includes(event.key)) {
        setVisible(true);
        return;
      }
      // Navigation continues an existing focus mode; it never enables it.
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
      setVisible(false);
    };
    const onPointer = () => setVisible(false);
    // Capture runs before an editor shortcut moves focus to its first input.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      if (previous === null) root.removeAttribute("data-sp-keyboard-focus");
      else root.setAttribute("data-sp-keyboard-focus", previous);
    };
  }, []);
}
