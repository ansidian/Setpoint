import { useCallback, useEffect, useRef, useState } from "react";

// All the floating-panel DOM/portal mechanics for the add-task panel: anchored
// positioning, mobile virtual-keyboard offset, ResizeObserver reflow, the
// open/close visibility transition, outside-pointerdown + Escape dismissal,
// body-overflow lock, and wheel containment. Lifted verbatim out of
// useAddTaskPanelController so the controller keeps only form/domain concerns.
//
// NOTE: intentionally does NOT consume the shared src/hooks/useDismissablePortal
// primitive. The add-task dismiss differs from that contract: the outside-click
// must spare THREE refs (anchor, panel, and the due picker), and Escape is
// due-picker-aware, runs for the inline host, and binds on window/bubble rather
// than document/capture. Adopting C1 here would change behavior; generalizing C1
// (multi-ref + configurable Escape policy) is tracked as a backlog follow-up.
export default function useAddTaskPanelPlacement({
  isInline,
  host,
  isMobile,
  onClose,
  anchorRef,
  panelRef,
  inputRef,
  duePickerRef,
  duePickerOpen,
  setDuePickerOpen,
}) {
  const [pos, setPos] = useState(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [visible, setVisible] = useState(() => isInline);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef(null);

  const requestClose = useCallback(() => {
    if (isInline) {
      onClose();
      return;
    }
    if (closeTimerRef.current) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 180);
  }, [isInline, onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const updatePos = useCallback(() => {
    if (isInline) {
      setPos({ inline: true });
      return;
    }
    if (host === "modal") {
      setPos({ modal: true });
      return;
    }
    if (isMobile) {
      setPos({ mobile: true });
      return;
    }
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const panelWidth = 360;
    const measuredHeight = panelRef.current?.offsetHeight;
    const panelHeight = measuredHeight && measuredHeight > 80 ? measuredHeight : 520;
    const margin = 12;

    let left = rect.left;
    if (left + panelWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - panelWidth - margin);
    }
    if (left < margin) left = margin;

    let top = rect.bottom + 8;
    if (top + panelHeight > window.innerHeight - margin) {
      const aboveTop = rect.top - panelHeight - 8;
      if (aboveTop > margin) top = aboveTop;
      else top = Math.max(margin, window.innerHeight - panelHeight - margin);
    }

    setPos({ top, left, width: panelWidth });
  }, [anchorRef, isInline, host, isMobile, panelRef]);

  useEffect(() => {
    if (isInline) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement (anchor rect) before paint
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [isInline, updatePos]);

  // Track virtual-keyboard height on mobile so the bottom-sheet sits above it.
  useEffect(() => {
    if (isInline) return undefined;
    if (!isMobile || typeof window === "undefined" || !window.visualViewport) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset offset when not on a mobile virtual keyboard
      setKeyboardOffset(0);
      return undefined;
    }
    const vv = window.visualViewport;
    const onResize = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardOffset(offset);
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, [isInline, isMobile]);

  useEffect(() => {
    if (isInline) return undefined;
    const element = panelRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => updatePos());
    observer.observe(element);
    return () => observer.disconnect();
  }, [isInline, updatePos, panelRef]);

  useEffect(() => {
    if (isInline) {
      inputRef.current?.focus({ preventScroll: true });
      return undefined;
    }

    const raf = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [isInline, inputRef]);

  useEffect(() => {
    if (isInline) return undefined;
    function handleClick(event) {
      if (anchorRef?.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      if (duePickerRef.current?.contains(event.target)) return;
      requestClose();
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [anchorRef, isInline, requestClose, panelRef, duePickerRef]);

  useEffect(() => {
    function handleKey(event) {
      if (event.key !== "Escape") return;
      if (duePickerOpen) {
        event.preventDefault();
        setDuePickerOpen(false);
        return;
      }
      requestClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [duePickerOpen, requestClose, setDuePickerOpen]);

  useEffect(() => {
    if (!isMobile || isInline) return undefined;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [isInline, isMobile]);

  useEffect(() => {
    const element = panelRef.current;
    if (!element) return undefined;
    function handleWheel(event) {
      const { scrollTop, scrollHeight, clientHeight } = element;
      const atTop = scrollTop <= 0 && event.deltaY < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && event.deltaY > 0;
      if (atTop || atBottom) event.preventDefault();
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [panelRef]);

  return { pos, keyboardOffset, visible, closing, requestClose };
}
