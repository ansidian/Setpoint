import { useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// walk up from el to find the nearest scrollable ancestor inside boundary
function findScrollableParent(el, boundary) {
  let node = el;
  while (node && node !== boundary) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return boundary;
}

// `height` (optional) forces a definite sheet height, overriding `maxHeight`.
// Pass this when hosting content that fills its parent via flex-1 / h-full
// (e.g. EmailReader): without a definite height, the sheet sizes to content
// and percentage/flex-1 children collapse. When `height` is set, the content
// wrapper also becomes a flex column so children's flex-1 engages.
export default function BottomSheet({ open, onClose, title, children, maxHeight = "70vh", height }) {
  const sheetRef = useRef(null);
  const contentRef = useRef(null);
  const dragStartY = useRef(null);
  const dragCurrentY = useRef(null);
  const isDragging = useRef(false);
  const activeScrollEl = useRef(null);

  // close on escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const onTouchStart = useCallback((e) => {
    // Find the actual scroll container at the touch target — the sheet may contain
    // nested overflow-y:auto wrappers (e.g. BriefingSearch's own scrollRef).
    // Drag-to-dismiss should only engage when that container is at scrollTop 0.
    const scrollEl = findScrollableParent(e.target, contentRef.current);
    activeScrollEl.current = scrollEl;
    if (scrollEl && scrollEl.scrollTop > 0) {
      isDragging.current = false;
      return;
    }
    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    dragCurrentY.current = 0;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!isDragging.current || dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    if (dy < 0) return; // only drag down
    dragCurrentY.current = dy;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      sheetRef.current.style.transition = "none";
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "";
    }
    if (dragCurrentY.current > 100) {
      onClose();
    } else if (sheetRef.current) {
      sheetRef.current.style.transform = "translateY(0)";
    }
    dragStartY.current = null;
    dragCurrentY.current = 0;
    isDragging.current = false;
  }, [onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      style={{ isolation: "isolate" }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#0b0b13]/50 animate-[fadeIn_200ms_ease]"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="absolute bottom-0 left-0 right-0 flex flex-col animate-[slideUp_300ms_cubic-bezier(0.16,1,0.3,1)]"
        style={{
          ...(height ? { height } : { maxHeight }),
          background: "#16161e",
          borderRadius: "12px 12px 0 0",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          overscrollBehavior: "contain",
          transition: "transform 300ms cubic-bezier(0.16,1,0.3,1)",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div
            className="w-9 h-1 rounded-full"
            style={{ background: "rgba(255,255,255,0.2)" }}
          />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-4 py-2 shrink-0"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <button
              onClick={onClose}
              className="text-muted-foreground/60 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Content */}
        <div
          ref={contentRef}
          className={height ? "flex-1 min-h-0 overflow-y-auto flex flex-col" : "flex-1 overflow-y-auto"}
          style={{ overscrollBehavior: "contain" }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
