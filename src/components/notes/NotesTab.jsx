import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from "motion/react";
import { Search } from "lucide-react";
import { getNotes, createNote, updateNote, deleteNote, reorderNotes, archiveNote } from "../../api.js";
import NoteItem from "./NoteItem.jsx";
import NotesPromoteMount from "./NotesPromoteMount.jsx";
import { selectVisibleNotes, collectTags, formatNoteAge } from "./notesModel.js";

export default function NotesTab({ accent, isMobile = false }) {
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [promote, setPromote] = useState(null); // { note, anchorRef }
  const inputRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    getNotes()
      .then((data) => { setNotes(data); setLoaded(true); })
      .catch((err) => { console.error("Failed to load notes:", err); setLoaded(true); });
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "/") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleCreate = useCallback(async (e) => {
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const content = input.trim();
    if (!content) return;
    setInput("");
    try { const note = await createNote(content); setNotes((prev) => [note, ...prev]); }
    catch (err) { console.error("Failed to create note:", err); setInput(content); }
  }, [input]);

  const handleUpdate = useCallback(async (id, content) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content } : n)));
    try { await updateNote(id, content); } catch (err) { console.error("Failed to update note:", err); }
  }, []);

  const handleDelete = useCallback(async (id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try { await deleteNote(id); } catch (err) { console.error("Failed to delete note:", err); }
  }, []);

  const handleArchive = useCallback(async (id) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, archived_at: new Date().toISOString() } : n)));
    try { await archiveNote(id, true); } catch (err) { console.error("Failed to archive note:", err); }
  }, []);

  // Promote success archives the source note — same path as a manual archive.
  const handlePromoted = useCallback((id) => { handleArchive(id); }, [handleArchive]);

  const filtering = !!query.trim() || !!activeTag;
  const visible = selectVisibleNotes({ notes, query, activeTag });
  const tags = collectTags(notes);

  const handleDragEnd = useCallback(async (event) => {
    if (filtering) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = notes.findIndex((n) => n.id === active.id);
    const newIndex = notes.findIndex((n) => n.id === over.id);
    const reordered = arrayMove(notes, oldIndex, newIndex);
    setNotes(reordered);
    try { await reorderNotes(reordered.map((n) => n.id)); } catch (err) { console.error("Failed to reorder notes:", err); }
  }, [notes, filtering]);

  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8, padding: "9px 12px", color: "#cdd6f4", fontSize: 13, fontFamily: "inherit",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, padding: isMobile ? 16 : "20px 24px", maxWidth: 720, margin: "0 auto", width: "100%" }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ color: "#cdd6f4", fontSize: 15, fontWeight: 600 }}>Notes</span>
          <span style={{ fontSize: 10, color: "#a6adc8", background: "rgba(255,255,255,0.06)", padding: "2px 7px", borderRadius: 9999 }}>
            {notes.filter((n) => !n.archived_at).length} active
          </span>
        </div>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleCreate}
          placeholder="Jot something down..."
          rows={1}
          style={{ ...inputStyle, resize: "none", minHeight: 38, marginBottom: 10 }}
        />
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#6c7086" }} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all notes…"
            style={{ ...inputStyle, paddingLeft: 32 }}
          />
        </div>
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
            {tags.map((tag) => {
              const on = activeTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag(on ? null : tag)}
                  style={{
                    fontSize: 11, padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
                    color: on ? (accent || "#cba6da") : "#a6adc8",
                    background: on ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${on ? (accent || "#cba6da") : "rgba(255,255,255,0.07)"}`,
                    transition: "color 150ms, background 150ms, border-color 150ms",
                  }}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
        {loaded && visible.length === 0 && (
          <div style={{ color: "var(--color-text-faint)", fontSize: 12, paddingTop: 8 }}>
            {filtering ? "No notes match." : "Nothing here yet — jot something above."}
          </div>
        )}
        {loaded && visible.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visible.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              <div data-testid="notes-tab-list" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <AnimatePresence initial={false}>
                  {visible.map((note) => (
                    <motion.div
                      key={note.id}
                      initial={{ opacity: 0, y: 8, scale: 0.99 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.99 }}
                      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <NoteItem
                        note={note}
                        accent={accent}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        onArchive={handleArchive}
                        onPromote={(n, ref) => setPromote({ note: n, anchorRef: ref })}
                        actionsAlwaysVisible={isMobile}
                        age={formatNoteAge(note.created_at)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <NotesPromoteMount
        key={promote?.note?.id}
        note={promote?.note}
        anchorRef={promote?.anchorRef}
        onClose={() => setPromote(null)}
        onPromoted={handlePromoted}
      />
    </div>
  );
}
