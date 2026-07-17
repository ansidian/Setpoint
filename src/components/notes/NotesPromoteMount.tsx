import AddTaskPanel from "../todoist/AddTaskPanel";
import { splitNoteForTask } from "./notesModel";
import type { RefObject } from "react";
import type { Note, NoteId } from "../../../shared/types/notes";

interface NotesPromoteMountProps {
  note?: Note | null;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onPromoted: (id: NoteId) => void;
}

// Renders the floating Todoist panel pre-seeded from a note. On a successful
// task create (onTaskAdded), the source note is archived (Locked Decision 4);
// cancelling the panel (onClose without onTaskAdded) leaves the note untouched.
export default function NotesPromoteMount({ note, anchorRef, onClose, onPromoted }: NotesPromoteMountProps) {
  if (!note) return null;
  const { title, description } = splitNoteForTask(note.content);
  return (
    <AddTaskPanel
      host="floating"
      anchorRef={anchorRef}
      initialInput={title}
      initialDescription={description}
      onClose={onClose}
      onTaskAdded={() => { onPromoted(note.id); onClose(); }}
    />
  );
}
