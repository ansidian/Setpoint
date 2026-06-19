import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Pencil, ListPlus, Archive, X } from "lucide-react";

const MENU_WIDTH = 184;
const ROW_H = 34;

function clamp(x, y) {
  if (typeof window === "undefined") return { left: x, top: y };
  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(Math.max(8, y), window.innerHeight - ROW_H * 4 - 16);
  return { left, top };
}

function MenuItem({ icon, label, onClick, danger }) {
  const Icon = icon;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%",
        background: "none", border: "none", cursor: "pointer", textAlign: "left",
        padding: "8px 12px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 6,
        color: danger ? "#f38ba8" : "#cdd6f4",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      <Icon size={13} strokeWidth={2.1} />
      {label}
    </button>
  );
}

export default function NoteContextMenu({ x, y, onClose, onEdit, onPromote, onArchive, onDelete }) {
  const ref = useRef(null);
  const { left, top } = clamp(x, y);

  useEffect(() => {
    function onPointer(e) { if (!ref.current?.contains(e.target)) onClose(); }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }
    function onScroll() { onClose(); }
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const run = (fn) => () => { fn?.(); onClose(); };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed", left, top, width: MENU_WIDTH, zIndex: 60,
        background: "rgba(24,24,37,0.98)", border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 9, padding: 4, boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
      }}
    >
      {onEdit && <MenuItem icon={Pencil} label="Edit" onClick={run(onEdit)} />}
      {onPromote && <MenuItem icon={ListPlus} label="Add to Todoist" onClick={run(onPromote)} />}
      {onArchive && <MenuItem icon={Archive} label="Archive" onClick={run(onArchive)} />}
      {onDelete && <MenuItem icon={X} label="Delete" onClick={run(onDelete)} danger />}
    </div>,
    document.body,
  );
}
