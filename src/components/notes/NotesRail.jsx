import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from "motion/react";
import { getNotes, createNote, updateNote, deleteNote, reorderNotes } from "../../api.js";
import NoteItem from "./NoteItem.jsx";

export default function NotesRail({ accent }) {
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getNotes()
      .then((data) => {
        setNotes(data);
        setLoaded(true);
      })
      .catch((err) => {
        console.error("Failed to load notes:", err);
        setLoaded(true);
      });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleCreate = useCallback(
    async (e) => {
      if (e.key !== "Enter") return;
      const content = input.trim();
      if (!content) return;
      setInput("");
      try {
        const note = await createNote(content);
        setNotes((prev) => [note, ...prev]);
      } catch (err) {
        console.error("Failed to create note:", err);
        setInput(content);
      }
    },
    [input],
  );

  const handleUpdate = useCallback(async (id, content) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content } : n)));
    try {
      await updateNote(id, content);
    } catch (err) {
      console.error("Failed to update note:", err);
    }
  }, []);

  const handleDelete = useCallback(async (id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await deleteNote(id);
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  }, []);

  const handleDragEnd = useCallback(
    async (event) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = notes.findIndex((n) => n.id === active.id);
      const newIndex = notes.findIndex((n) => n.id === over.id);
      const reordered = arrayMove(notes, oldIndex, newIndex);
      setNotes(reordered);

      try {
        await reorderNotes(reordered.map((n) => n.id));
      } catch (err) {
        console.error("Failed to reorder notes:", err);
      }
    },
    [notes],
  );

  return (
    <div>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: "#cdd6f4", fontSize: 13, fontWeight: 600 }}>Notes</span>
        {notes.length > 0 && (
          <span
            style={{
              fontSize: 10,
              color: "#a6adc8",
              background: "rgba(255,255,255,0.06)",
              padding: "2px 6px",
              borderRadius: 9999,
            }}
          >
            {notes.length}
          </span>
        )}
      </div>

      {/* Always-visible input */}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleCreate}
        placeholder="Jot something down..."
        style={{
          width: "100%",
          background: "rgba(255,255,255, 0.04)",
          border: "1px solid rgba(255,255,255, 0.08)",
          borderRadius: 8,
          padding: "8px 12px",
          color: "#cdd6f4",
          fontSize: 12,
          fontFamily: "inherit",
          outline: "none",
          marginBottom: 14,
          boxSizing: "border-box",
        }}
        onFocus={(e) => (e.target.style.borderColor = "rgba(203,166,218, 0.3)")}
        onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255, 0.08)")}
      />

      {/* Note list */}
      {loaded && notes.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={notes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <AnimatePresence initial={false}>
                {notes.map((note) => (
                  <motion.div
                    key={note.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <NoteItem
                      note={note}
                      accent={accent}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
