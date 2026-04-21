import { useState, useRef, useEffect, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { linkifyText } from "./notesUtils.jsx";

export default function NoteItem({ note, accent, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id });

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
      ta.style.height = ta.scrollHeight + "px";
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
    e.target.style.height = e.target.scrollHeight + "px";
  };

  return (
    <div
      ref={setNodeRef}
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
        {...attributes}
        {...listeners}
        style={{
          color: "rgba(255,255,255, 0.15)",
          fontSize: 11,
          paddingTop: 1,
          flexShrink: 0,
          cursor: isDragging ? "grabbing" : "grab",
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
              whiteSpace: "pre-wrap",
            }}
          >
            {linkifyText(note.content, accent)}
          </div>
        )}
      </div>

      {/* Delete button */}
      <button
        onClick={() => onDelete(note.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        style={{
          background: "none",
          border: "none",
          color: "rgba(255,255,255, 0.4)",
          fontSize: 11,
          flexShrink: 0,
          paddingTop: 1,
          cursor: "pointer",
          position: "relative",
          lineHeight: 1.5,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#f38ba8")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255, 0.4)")}
      >
        ✕
      </button>
    </div>
  );
}
