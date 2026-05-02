import { useCallback, useEffect, useRef } from "react";
import {
  isFloatingDetailPanelTarget,
  isFloatingDetailTriggerTarget,
} from "./calendarFloatingDetailModel.js";

export default function useCalendarModalOutsideDismiss({
  open,
  panelRef,
  floatingDetail,
  setFloatingDetail,
  closeCalendarModal,
  shakeFloatingEditor,
}) {
  const suppressOutsideClickRef = useRef(new Map());

  const suppressOutsideClick = useCallback((test, key = "default") => {
    if (test) {
      suppressOutsideClickRef.current.set(key, test);
    } else {
      suppressOutsideClickRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const id = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, panelRef]);

  useEffect(() => {
    if (open) return;
    suppressOutsideClickRef.current.clear();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    function handleClick(event) {
      const suppressors = [...suppressOutsideClickRef.current.values()];
      if (suppressors.some((test) => test?.(event.target))) return;
      if (isFloatingDetailPanelTarget(event.target)) return;
      const roleLayer = event.target.closest?.('[role="menu"], [role="dialog"], [role="listbox"]');
      if (roleLayer && !panelRef.current?.contains(roleLayer)) return;
      if (floatingDetail?.open) {
        if (floatingDetail.mode === "edit" || floatingDetail.mode === "create") {
          if (floatingDetail.dirty && !isFloatingDetailTriggerTarget(event.target)) {
            shakeFloatingEditor();
          }
          return;
        }
        if (!isFloatingDetailTriggerTarget(event.target)) {
          setFloatingDetail(null);
          return;
        }
        return;
      }
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        closeCalendarModal();
      }
    }

    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [
    closeCalendarModal,
    floatingDetail?.dirty,
    floatingDetail?.mode,
    floatingDetail?.open,
    open,
    panelRef,
    setFloatingDetail,
    shakeFloatingEditor,
  ]);

  return suppressOutsideClick;
}
