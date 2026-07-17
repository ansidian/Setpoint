import { useEffect, useRef } from "react";
import type { ComponentType, MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import { Pencil, ListPlus, Archive, ArchiveRestore, X } from "lucide-react";
import type { LucideProps } from "lucide-react";

const MENU_WIDTH = 184;
const ROW_H = 34;

type MenuAction = () => void;

interface MenuItemProps {
  icon: ComponentType<LucideProps>;
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  danger?: boolean;
}

export interface NoteContextMenuProps {
  x: number;
  y: number;
  onClose: MenuAction;
  onEdit?: MenuAction;
  onPromote?: MenuAction;
  onArchive?: MenuAction;
  onUnarchive?: MenuAction;
  onDelete?: MenuAction;
  count?: number;
}

function clamp(x: number, y: number) {
  if (typeof window === "undefined") return { left: x, top: y };
  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(Math.max(8, y), window.innerHeight - ROW_H * 4 - 16);
  return { left, top };
}

function MenuItem({ icon, label, onClick, danger = false }: MenuItemProps) {
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
        color: danger ? "var(--sp-rose)" : "var(--sp-text)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      <Icon size={13} strokeWidth={2.1} />
      {label}
    </button>
  );
}

export default function NoteContextMenu({ x, y, onClose, onEdit, onPromote, onArchive, onUnarchive, onDelete, count = 0 }: NoteContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { left, top } = clamp(x, y);
  const suffix = count > 1 ? ` ${count}` : ""; // bulk menu: "Archive 3", "Delete 3"

  useEffect(() => {
    function onPointer(e: PointerEvent) { if (!ref.current?.contains(e.target as Node)) onClose(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }
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

  const run = (fn?: MenuAction) => () => { fn?.(); onClose(); };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed", left, top, width: MENU_WIDTH, zIndex: 60,
        background: "color-mix(in srgb, var(--sp-mantle) 98%, transparent)", border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 9, padding: 4, boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
      }}
    >
      {onEdit && <MenuItem icon={Pencil} label="Edit" onClick={run(onEdit)} />}
      {onPromote && <MenuItem icon={ListPlus} label="Add to Todoist" onClick={run(onPromote)} />}
      {onArchive && <MenuItem icon={Archive} label={`Archive${suffix}`} onClick={run(onArchive)} />}
      {onUnarchive && <MenuItem icon={ArchiveRestore} label={`Unarchive${suffix}`} onClick={run(onUnarchive)} />}
      {onDelete && <MenuItem icon={X} label={`Delete${suffix}`} onClick={run(onDelete)} danger />}
    </div>,
    document.body,
  );
}
