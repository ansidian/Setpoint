import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from "motion/react";
import { Search, NotebookPen } from "lucide-react";
import { getNotes, createNote, updateNote, deleteNote, reorderNotes, archiveNote } from "../../api.js";
import NoteItem from "./NoteItem.jsx";
import NoteEditor from "./NoteEditor.jsx";
import NotesPromoteMount from "./NotesPromoteMount.jsx";
import NotesToast from "./NotesToast.jsx";
import { selectVisibleNotes, collectTags, formatNoteAge } from "./notesModel.js";

const NOTES_UNDO_MS = 6000;

// Active / Archived view switch in the header.
function ViewToggle({ label, count, on, onClick, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="sp-focus-ring"
      style={{
        fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
        display: "inline-flex", alignItems: "center", gap: 5,
        color: on ? (accent || "var(--sp-accent)") : "var(--sp-subtext)",
        background: on ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${on ? (accent || "var(--sp-accent)") : "rgba(255,255,255,0.07)"}`,
        transition: "color 150ms, background 150ms, border-color 150ms",
      }}
    >
      {label}
      <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.75 }}>{count}</span>
    </button>
  );
}

export default function NotesTab({ accent, isMobile = false }) {
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState(null);
  const [view, setView] = useState("active"); // "active" | "archived"
  const [loaded, setLoaded] = useState(false);
  const [promote, setPromote] = useState(null); // { note, anchorRef }
  const [toast, setToast] = useState(null); // { id, kind, message, onUndo }
  const [selected, setSelected] = useState(() => new Set()); // batch-selection note ids
  const searchRef = useRef(null);
  const visibleIdsRef = useRef([]); // ids currently shown (for Cmd/Ctrl+A select-all)
  const toastTimerRef = useRef(null);
  const pendingDeleteRef = useRef(null); // { ids } — server deletes deferred during the undo window

  const batchActive = selected.size > 0;

  useEffect(() => {
    getNotes()
      .then((data) => { setNotes(data); setLoaded(true); })
      .catch((err) => { console.error("Failed to load notes:", err); setLoaded(true); });
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "/") return;
      const tag = e.target?.tagName;
      // CM's editor is a contenteditable <div>, not INPUT/TEXTAREA — guard it
      // explicitly so typing "/" in a note doesn't yank focus to search.
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.closest?.(".cm-editor")) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // --- Selection (batch mode) -------------------------------------------------
  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected((prev) => (prev.size ? new Set() : prev)), []);
  const selectAllVisible = useCallback(() => setSelected(new Set(visibleIdsRef.current)), []);
  // Selection is per-view; switching Active/Archived clears it.
  const changeView = useCallback((v) => { setView(v); clearSelection(); }, [clearSelection]);

  // --- Toast + deferred-delete lifecycle --------------------------------------
  const flushPendingDelete = useCallback(() => {
    const pending = pendingDeleteRef.current;
    pendingDeleteRef.current = null;
    if (pending) pending.ids.forEach((id) => deleteNote(id).catch((err) => console.error("Failed to delete note:", err)));
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
    setToast(null);
  }, []);

  // Show a toast and open the undo window. Commits any earlier deferred delete
  // first so a second action never strands the previous one.
  const presentToast = useCallback((next) => {
    flushPendingDelete();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = setTimeout(() => {
      flushPendingDelete();
      setToast(null);
      toastTimerRef.current = null;
    }, NOTES_UNDO_MS);
  }, [flushPendingDelete]);

  const handleToastUndo = useCallback(() => { toast?.onUndo?.(); }, [toast]);

  const handleCreateSubmit = useCallback(async (raw) => {
    const content = (raw ?? "").trim();
    if (!content) return;
    setInput("");
    setView("active"); // a new note is active — make sure it lands in view
    try { const note = await createNote(content); setNotes((prev) => [note, ...prev]); }
    catch (err) { console.error("Failed to create note:", err); setInput(content); }
  }, []);

  const handleUpdate = useCallback(async (id, content) => {
    // Bump updated_at optimistically so the "edited" label reflects this edit
    // immediately instead of waiting for a refetch.
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content, updated_at: new Date().toISOString() } : n)));
    try { await updateNote(id, content); } catch (err) { console.error("Failed to update note:", err); }
  }, []);

  // Delete is DEFERRED for one or many notes: rows leave immediately, but the
  // server deletes wait out the undo window so Undo restores them in place.
  const deleteNotes = useCallback((ids) => {
    const idSet = new Set(ids);
    const removed = [];
    notes.forEach((n, i) => { if (idSet.has(n.id)) removed.push({ note: n, index: i }); });
    if (!removed.length) return;
    setNotes((prev) => prev.filter((n) => !idSet.has(n.id)));
    const count = removed.length;
    presentToast({
      id: `delete-${[...idSet].join("-")}`,
      kind: "delete",
      message: count === 1 ? "Note deleted" : `${count} notes deleted`,
      onUndo: () => {
        pendingDeleteRef.current = null; // cancel the server deletes
        setNotes((cur) => {
          const next = cur.slice();
          for (const { note, index } of removed) { // ascending index → each splice lands correctly
            if (next.some((n) => n.id === note.id)) continue;
            next.splice(Math.min(index, next.length), 0, note);
          }
          return next;
        });
        dismissToast();
      },
    });
    pendingDeleteRef.current = { ids: [...idSet] }; // set AFTER presentToast (flushes any prior pending delete)
  }, [notes, presentToast, dismissToast]);

  // Archive/unarchive one or many notes; commits immediately (reversible) with an
  // Undo that restores each note's exact prior archived_at. `silent` skips the
  // toast (the quiet promote-to-task path).
  const setArchived = useCallback((ids, archived, { silent = false } = {}) => {
    const idSet = new Set(ids);
    const prevById = new Map();
    notes.forEach((n) => { if (idSet.has(n.id)) prevById.set(n.id, n.archived_at ?? null); });
    if (!prevById.size) return;
    const stamp = new Date().toISOString();
    setNotes((cur) => cur.map((n) => (idSet.has(n.id) ? { ...n, archived_at: archived ? stamp : null } : n)));
    ids.forEach((id) => archiveNote(id, archived).catch((err) => console.error("Failed to (un)archive note:", err)));
    if (silent) { flushPendingDelete(); return; }
    const count = prevById.size;
    const verb = archived ? "archived" : "restored";
    presentToast({
      id: `${archived ? "archive" : "restore"}-${[...idSet].join("-")}`,
      kind: archived ? "archive" : "restore",
      message: count === 1 ? `Note ${verb}` : `${count} notes ${verb}`,
      onUndo: () => {
        setNotes((cur) => cur.map((n) => (prevById.has(n.id) ? { ...n, archived_at: prevById.get(n.id) } : n)));
        ids.forEach((id) => archiveNote(id, !archived).catch((err) => console.error("Failed to undo (un)archive:", err)));
        dismissToast();
      },
    });
  }, [notes, presentToast, dismissToast, flushPendingDelete]);

  const handleDelete = useCallback((id) => deleteNotes([id]), [deleteNotes]);
  const handleArchive = useCallback((id, opts) => setArchived([id], true, opts), [setArchived]);
  const handleUnarchive = useCallback((id) => setArchived([id], false), [setArchived]);
  const handlePromoted = useCallback((id) => setArchived([id], true, { silent: true }), [setArchived]);

  const bulkDelete = useCallback(() => { deleteNotes([...selected]); clearSelection(); }, [deleteNotes, selected, clearSelection]);
  const bulkArchive = useCallback(() => { setArchived([...selected], true); clearSelection(); }, [setArchived, selected, clearSelection]);
  const bulkUnarchive = useCallback(() => { setArchived([...selected], false); clearSelection(); }, [setArchived, selected, clearSelection]);

  // Commit any deferred delete (and clear the timer) on unmount / page hide so a
  // pending delete is never silently dropped.
  useEffect(() => {
    const onHide = () => flushPendingDelete();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      flushPendingDelete();
    };
  }, [flushPendingDelete]);

  // Batch-mode keys: Escape clears the selection; Cmd/Ctrl+A selects all visible
  // (unless typing in the search/editor). The effect only subscribes while a
  // selection exists, and <Activity> tears down this tab's effects when it's
  // hidden — so the listener can't hijack select-all from another tab. Bubble
  // phase so an open context menu's Escape (capture + stopPropagation) wins first.
  useEffect(() => {
    if (!batchActive) return undefined;
    function onKey(e) {
      if (e.key === "Escape") { clearSelection(); return; }
      if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
        const t = e.target;
        const inText = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.closest?.(".cm-editor");
        if (inText) return;
        e.preventDefault();
        selectAllVisible();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [batchActive, clearSelection, selectAllVisible]);

  const filtering = !!query.trim() || !!activeTag;
  const visible = selectVisibleNotes({ notes, query, activeTag, view });
  const tags = collectTags(notes);
  const activeCount = notes.filter((n) => !n.archived_at).length;
  const archivedCount = notes.length - activeCount;
  const canReorder = view === "active" && !filtering && !batchActive;

  // Keep the visible-id list current for Cmd/Ctrl+A select-all (set in an effect,
  // not during render, so we never write a ref mid-render).
  useEffect(() => { visibleIdsRef.current = visible.map((n) => n.id); });

  const handleDragEnd = useCallback(async (event) => {
    if (view !== "active" || filtering) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = notes.findIndex((n) => n.id === active.id);
    const newIndex = notes.findIndex((n) => n.id === over.id);
    const reordered = arrayMove(notes, oldIndex, newIndex);
    setNotes(reordered);
    try { await reorderNotes(reordered.map((n) => n.id)); } catch (err) { console.error("Failed to reorder notes:", err); }
  }, [notes, filtering, view]);

  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8, padding: "9px 12px", color: "var(--sp-text)", fontSize: isMobile ? 16 : 13, fontFamily: "inherit",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", minHeight: 0, padding: isMobile ? 16 : "20px 24px", maxWidth: 720, margin: "0 auto", width: "100%" }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ color: "var(--sp-text)", fontSize: 15, fontWeight: 600 }}>Notes</span>
          <div style={{ display: "flex", gap: 5, marginLeft: "auto" }}>
            <ViewToggle label="Active" count={activeCount} on={view === "active"} onClick={() => changeView("active")} accent={accent} />
            {(archivedCount > 0 || view === "archived") && (
              <ViewToggle label="Archived" count={archivedCount} on={view === "archived"} onClick={() => changeView("archived")} accent={accent} />
            )}
          </div>
        </div>
        <div style={{ ...inputStyle, padding: 0, marginBottom: 10, overflow: "hidden" }}>
          <NoteEditor
            value={input}
            onChange={setInput}
            onSubmit={handleCreateSubmit}
            tags={tags}
            placeholder="Jot something down…"
            submitOnEnter
            ariaLabel="New note"
          />
        </div>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--sp-overlay)" }} />
          <input
            ref={searchRef}
            className="notes-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all notes…"
            aria-label="Search all notes"
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
                  className="sp-focus-ring"
                  style={{
                    fontSize: 11, padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
                    color: on ? (accent || "var(--sp-accent)") : "var(--sp-subtext)",
                    background: on ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${on ? (accent || "var(--sp-accent)") : "rgba(255,255,255,0.07)"}`,
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
          filtering ? (
            <div style={{ color: "var(--color-text-faint)", fontSize: 12, paddingTop: 8 }}>No notes match.</div>
          ) : view === "archived" ? (
            <div style={{ color: "var(--color-text-faint)", fontSize: 12, paddingTop: 8 }}>No archived notes.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 8, paddingTop: 56 }}>
              <NotebookPen size={26} strokeWidth={1.6} style={{ color: "color-mix(in srgb, var(--sp-accent) 70%, transparent)" }} aria-hidden="true" />
              <div style={{ color: "var(--sp-text)", fontSize: 13, fontWeight: 500 }}>No notes yet</div>
              <div style={{ color: "var(--color-text-faint)", fontSize: 12, maxWidth: 240 }}>
                Jot a thought above. Add #tags to group them, or promote one to a task.
              </div>
            </div>
          )
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
                        tags={tags}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        onArchive={view === "active" ? handleArchive : undefined}
                        onUnarchive={view === "archived" ? handleUnarchive : undefined}
                        onPromote={view === "active" ? (n, ref) => setPromote({ note: n, anchorRef: ref }) : undefined}
                        draggable={canReorder}
                        actionsAlwaysVisible={isMobile}
                        age={formatNoteAge(note.created_at)}
                        selected={selected.has(note.id)}
                        selectedCount={selected.size}
                        onToggleSelect={toggleSelect}
                        onClearSelection={clearSelection}
                        onBulkArchive={view === "active" ? bulkArchive : undefined}
                        onBulkUnarchive={view === "archived" ? bulkUnarchive : undefined}
                        onBulkDelete={bulkDelete}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <NotesToast toast={toast} onUndo={handleToastUndo} />

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
