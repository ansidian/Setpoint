import { useCallback, useEffect, useRef } from "react";

// The clean-editor-cancel-on-scroll cross-cut, extracted from
// CalendarScrollContainer's onScroll handler. A clean (non-dirty) floating
// editor cancels the first time its owner scrolls; a dirty one stays. The latch
// (cleanEditorCanceledRef) fires the cancel once per editor session and resets
// when the editor identity/dirtiness changes. Programmatic navigations stream
// scroll events of their own and must NOT cancel — the caller passes the
// programmatic-nav flag in at scroll time.
export default function useEditorCancelOnScroll({
  floatingDetailOpen,
  floatingDetailMode,
  floatingEditorDirty,
  onCancelFloatingEditor,
}) {
  const editorScrollRef = useRef({ open: false, dirty: false, cancel: null });
  const cleanEditorCanceledRef = useRef(false);

  useEffect(() => {
    editorScrollRef.current = {
      open: floatingDetailMode === "edit" || floatingDetailMode === "create",
      dirty: !!floatingEditorDirty,
      cancel: onCancelFloatingEditor,
    };
  });

  useEffect(() => {
    cleanEditorCanceledRef.current = false;
  }, [floatingDetailMode, floatingEditorDirty, floatingDetailOpen]);

  // Returns nothing; mirrors the original inline branch exactly.
  return useCallback((programmaticNavActive) => {
    const editor = editorScrollRef.current;
    // Clean editors cancel on owner scroll only: programmatic navigations
    // (chevron, jump, mount centering) stream scroll events of their own and
    // deliberately preserve open workspaces.
    if (
      !programmaticNavActive &&
      editor.open &&
      !editor.dirty &&
      !cleanEditorCanceledRef.current
    ) {
      cleanEditorCanceledRef.current = true;
      editor.cancel?.();
    }
  }, []);
}
