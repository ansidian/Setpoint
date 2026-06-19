import { useState, useRef, useCallback } from "react";
import { MoreHorizontal } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { renderNoteMarkdown } from "./renderNoteMarkdown.jsx";
import { toggleCheckboxLine } from "./noteEditorExtensions.js";
import NoteContextMenu from "./NoteContextMenu.jsx";
import NoteEditor from "./NoteEditor.jsx";

export default function NoteItem({
  note, accent, onUpdate, onDelete, onArchive, onPromote,
  compactPreview = false, actionsAlwaysVisible = false, age = "", tags = [],
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState(null); // { x, y } | null
  const promoteRef = useRef(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id, disabled: editing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const startEdit = useCallback(() => {
    setDraft(note.content);
    setEditing(true);
  }, [note.content]);

  const commitEditWith = useCallback((v) => {
    const trimmed = (v ?? draft).trim();
    if (trimmed && trimmed !== note.content) onUpdate(note.id, trimmed);
    setEditing(false);
  }, [draft, note.id, note.content, onUpdate]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handlePointerDownCapture = useCallback((event) => {
    const interactive = event.target.closest("a, button, textarea, input, .cm-editor");
    if (interactive) event.stopPropagation();
  }, []);

  const handleRowKeyDown = useCallback((e) => {
    if (editing) return;
    if ((e.key === "t" || e.key === "T") && onPromote) {
      e.preventDefault();
      // Stop the row's `t` from also reaching the shell g-chord window listener
      // (a pending `g` + `t` would otherwise fire promote AND open-deadline-create).
      e.stopPropagation();
      onPromote(note, promoteRef);
    }
  }, [editing, onPromote, note]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={handleRowKeyDown}
      onPointerDownCapture={handlePointerDownCapture}
      onContextMenu={(e) => { if (editing) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      style={{
        ...style,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "10px 12px",
        background: "rgba(36,36,58, 0.4)",
        border: editing
          ? "1px solid rgba(203,166,218, 0.2)"
          : "1px solid rgba(255,255,255, 0.04)",
        borderRadius: 8,
        position: "relative",
        cursor: editing ? "text" : isDragging ? "grabbing" : "grab",
      }}
      className="group"
    >
      {/* Hover overlay */}
      <div
        className="absolute inset-0 rounded-lg bg-white/0 group-hover:bg-white/[0.03] transition-colors duration-150 pointer-events-none"
        style={{ borderRadius: 8 }}
      />

      {/* Drag handle */}
      <div
        style={{
          color: "rgba(255,255,255, 0.15)",
          fontSize: 11,
          paddingTop: 1,
          flexShrink: 0,
          position: "relative",
          lineHeight: 1.5,
        }}
        className="group-hover:[color:rgba(255,255,255,0.3)]"
      >
        ⠿
      </div>

      {/* Content */}
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {editing ? (
          <NoteEditor
            value={draft}
            onChange={setDraft}
            onSubmit={(v) => commitEditWith(v)}
            onCancel={cancelEdit}
            onBlur={(v) => commitEditWith(v)}
            tags={tags}
            autoFocus
            placeholder=""
            submitOnEnter
            maxHeight={140}
          />
        ) : (
          <div
            onDoubleClick={startEdit}
            style={{
              color: "#cdd6f4",
              fontSize: 12,
              lineHeight: 1.5,
              cursor: "default",
              wordBreak: "break-word",
              whiteSpace: compactPreview ? "normal" : "pre-wrap",
              ...(compactPreview ? {
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              } : {}),
            }}
          >
            {renderNoteMarkdown(note.content, {
              accent,
              onToggleCheckbox: (idx) => onUpdate(note.id, toggleCheckboxLine(note.content, idx)),
            })}
          </div>
        )}
      </div>

      {/* Actions cluster */}
      <div
        className={
          actionsAlwaysVisible
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        }
        style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, position: "relative" }}
      >
        {age && (
          <span style={{ fontSize: 10, color: "var(--color-text-faint)", fontVariantNumeric: "tabular-nums" }}>{age}</span>
        )}
        <button
          ref={promoteRef}
          type="button"
          aria-label="Note actions"
          aria-haspopup="menu"
          aria-expanded={menu ? "true" : "false"}
          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 4, y: r.bottom + 4 }); }}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", padding: 1, cursor: "pointer", lineHeight: 1, borderRadius: 4 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#cdd6f4")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
          onFocus={(e) => (e.currentTarget.style.color = "#cdd6f4")}
          onBlur={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
        >
          <MoreHorizontal size={15} strokeWidth={2.2} />
        </button>
      </div>
      {menu && (
        <NoteContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          onEdit={startEdit}
          onPromote={onPromote ? () => onPromote(note, promoteRef) : undefined}
          onArchive={onArchive ? () => onArchive(note.id) : undefined}
          onDelete={() => onDelete(note.id)}
        />
      )}
    </div>
  );
}
