import { useState, useRef, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { linkifyText } from "./notesUtils.jsx";

const EDIT_TEXTAREA_MAX_HEIGHT = 96;

export default function NoteItem({ note, accent, onUpdate, onDelete, compactPreview = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [deleteActive, setDeleteActive] = useState(false);
  const textareaRef = useRef(null);

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

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== note.content) {
      onUpdate(note.id, trimmed);
    }
    setEditing(false);
  }, [draft, note.id, note.content, onUpdate]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, EDIT_TEXTAREA_MAX_HEIGHT)}px`;
      ta.style.overflowY = ta.scrollHeight > EDIT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
    }
  }, [editing]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const handleInput = (e) => {
    setDraft(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, EDIT_TEXTAREA_MAX_HEIGHT)}px`;
    e.target.style.overflowY = e.target.scrollHeight > EDIT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  };

  const handlePointerDownCapture = useCallback((event) => {
    const interactive = event.target.closest("a, button, textarea, input");
    if (interactive) event.stopPropagation();
  }, []);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onPointerDownCapture={handlePointerDownCapture}
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
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onBlur={commitEdit}
            rows={1}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#cdd6f4",
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "inherit",
              resize: "none",
              padding: 0,
              margin: 0,
              maxHeight: EDIT_TEXTAREA_MAX_HEIGHT,
              overflowY: "hidden",
            }}
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
            {linkifyText(note.content, accent)}
          </div>
        )}
      </div>

      {/* Delete button */}
      <button
        type="button"
        aria-label="Delete note"
        onClick={() => onDelete(note.id)}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150"
        style={{
          background: "none",
          border: "none",
          color: deleteActive ? "#f38ba8" : "rgba(255,255,255, 0.4)",
          fontSize: 11,
          flexShrink: 0,
          padding: 1,
          cursor: "pointer",
          position: "relative",
          lineHeight: 1.5,
          borderRadius: 4,
          outline: deleteActive ? "1px solid rgba(243,139,168,0.35)" : "none",
          transition: "color 140ms ease, transform 140ms cubic-bezier(0.22,1,0.36,1)",
          transform: deleteActive ? "translateY(-1px)" : "translateY(0)",
        }}
        onMouseEnter={() => setDeleteActive(true)}
        onMouseLeave={() => setDeleteActive(false)}
        onFocus={() => setDeleteActive(true)}
        onBlur={() => setDeleteActive(false)}
      >
        <X size={12} strokeWidth={2.2} />
      </button>
    </div>
  );
}
