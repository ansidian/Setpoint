import { useState, useRef, useCallback } from "react";
import { MoreHorizontal, Pencil } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { renderNoteMarkdown } from "./renderNoteMarkdown.jsx";
import { toggleCheckboxLine } from "./noteEditorExtensions.js";
import { parseTags, stripTags, noteEditedAge } from "./notesModel.js";
import NoteContextMenu from "./NoteContextMenu.jsx";
import NoteEditor from "./NoteEditor.jsx";

export default function NoteItem({
  note, accent, onUpdate, onDelete, onArchive, onUnarchive, onPromote,
  compactPreview = false, actionsAlwaysVisible = false, age = "", tags = [], draggable = true,
  selected = false, selectedCount = 0, onToggleSelect, onClearSelection, onBulkArchive, onBulkUnarchive, onBulkDelete,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState(null); // { x, y } | null
  const promoteRef = useRef(null);

  // Tags are surfaced once as footer chips, so strip them from the body render.
  const noteTags = parseTags(note.content);
  const bodyContent = stripTags(note.content);
  const editedAge = noteEditedAge(note);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id, disabled: editing || !draggable });

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

  // Cmd/Ctrl+click toggles batch selection (and implicitly enters batch mode).
  // A plain left-click while a selection exists clears it — single-click otherwise
  // does nothing here, so this matches the conventional "click to deselect".
  const handleRowClick = useCallback((e) => {
    if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(note.id);
      return;
    }
    if (selectedCount > 0 && onClearSelection) onClearSelection();
  }, [onToggleSelect, onClearSelection, selectedCount, note.id]);

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
      onClick={handleRowClick}
      onPointerDownCapture={handlePointerDownCapture}
      onContextMenu={(e) => { if (editing) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      style={{
        ...style,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "11px 12px",
        background: selected
          ? (accent ? `${accent}1f` : "color-mix(in srgb, var(--sp-accent) 12%, transparent)")
          : "color-mix(in srgb, var(--sp-surface) 40%, transparent)",
        border: selected
          ? `1px solid ${accent || "var(--sp-accent)"}`
          : editing
            ? "1px solid color-mix(in srgb, var(--sp-accent) 20%, transparent)"
            : "1px solid rgba(255,255,255, 0.08)",
        borderRadius: 8,
        position: "relative",
        cursor: editing ? "text" : !draggable ? "default" : isDragging ? "grabbing" : "grab",
      }}
      className="note-row group"
    >
      {/* Hover overlay */}
      <div
        className="absolute inset-0 rounded-lg bg-white/0 group-hover:bg-white/[0.03] transition-colors duration-150 pointer-events-none"
        style={{ borderRadius: 8 }}
      />

      {/* Drag handle — hidden when the row can't be reordered (e.g. archived view) */}
      {draggable && (
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
      )}

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
          <>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div
                onDoubleClick={startEdit}
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: "var(--sp-text)",
                  fontSize: 13,
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
                {renderNoteMarkdown(bodyContent, {
                  accent,
                  onToggleCheckbox: (idx) => onUpdate(note.id, toggleCheckboxLine(note.content, idx)),
                })}
              </div>
              {age && (
                <span style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.5, marginTop: 1, color: "var(--color-text-faint)", fontVariantNumeric: "tabular-nums" }}>{age}</span>
              )}
            </div>
            {(noteTags.length > 0 || editedAge) && (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7, marginTop: 7 }}>
                {noteTags.map((t) => (
                  <span key={t} style={{ color: accent || "var(--ea-accent, var(--sp-accent))", background: "color-mix(in srgb, var(--sp-accent) 12%, transparent)", borderRadius: 999, padding: "1px 8px", fontSize: 11 }}>#{t}</span>
                ))}
                {editedAge && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-text-faint)" }}>
                    <Pencil size={11} strokeWidth={2} aria-hidden="true" /> edited {editedAge}
                  </span>
                )}
              </div>
            )}
          </>
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
        <button
          ref={promoteRef}
          type="button"
          aria-label="Note actions"
          aria-haspopup="menu"
          aria-expanded={menu ? "true" : "false"}
          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 4, y: r.bottom + 4 }); }}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", padding: 1, cursor: "pointer", lineHeight: 1, borderRadius: 4 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sp-text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
          onFocus={(e) => (e.currentTarget.style.color = "var(--sp-text)")}
          onBlur={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
        >
          <MoreHorizontal size={15} strokeWidth={2.2} />
        </button>
      </div>
      {menu && (
        selected && selectedCount > 0 ? (
          // Right-clicking a selected note acts on the whole selection (bulk).
          <NoteContextMenu
            x={menu.x}
            y={menu.y}
            onClose={closeMenu}
            count={selectedCount}
            onArchive={onBulkArchive}
            onUnarchive={onBulkUnarchive}
            onDelete={onBulkDelete}
          />
        ) : (
          <NoteContextMenu
            x={menu.x}
            y={menu.y}
            onClose={closeMenu}
            onEdit={startEdit}
            onPromote={onPromote ? () => onPromote(note, promoteRef) : undefined}
            onArchive={onArchive ? () => onArchive(note.id) : undefined}
            onUnarchive={onUnarchive ? () => onUnarchive(note.id) : undefined}
            onDelete={() => onDelete(note.id)}
          />
        )
      )}
    </div>
  );
}
