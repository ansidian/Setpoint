import AddTaskPanel from "../todoist/AddTaskPanel.jsx";
import { splitNoteForTask } from "./notesModel.js";

// Renders the floating Todoist panel pre-seeded from a note. On a successful
// task create (onTaskAdded), the source note is archived (Locked Decision 4);
// cancelling the panel (onClose without onTaskAdded) leaves the note untouched.
export default function NotesPromoteMount({ note, anchorRef, onClose, onPromoted }) {
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
