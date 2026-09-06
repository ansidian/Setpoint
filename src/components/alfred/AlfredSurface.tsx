import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import "./AlfredSurface.css";

/** One stable portal: changing placement never remounts the conversation. */
export default function AlfredSurface({ open, dockTarget, onClose, children }: {
  open: boolean;
  dockTarget?: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected && !trigger.closest('[inert], [hidden]')) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (!dockTarget) {
      frame.removeAttribute("style");
      return;
    }
    const place = () => {
      const rect = dockTarget.getBoundingClientRect();
      Object.assign(frame.style, {
        top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`,
        height: `${rect.height}px`, right: "auto", bottom: "auto",
        visibility: rect.width && rect.height ? "visible" : "hidden",
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(dockTarget);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [dockTarget]);

  return createPortal(
    <div ref={frameRef} className={`alfred-surface ${dockTarget ? "alfred-surface--docked" : "alfred-surface--workbench"}`}
      data-open={open} aria-hidden={!open} inert={!open ? true : undefined} data-suspend-calendar-hotkeys="all">
      {!dockTarget && <div className="alfred-backdrop" aria-hidden="true" onPointerDown={onClose} />}
      <aside className="alfred-conversation" aria-label="Alfred panel">{children}</aside>
    </div>, document.body,
  );
}
