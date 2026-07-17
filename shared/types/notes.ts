export type NoteId = string | number;
export type NotesView = "active" | "archived";

export interface Note {
  id: NoteId;
  user_id: string;
  content: string;
  sort_order: number;
  created_at: string;
  archived_at?: string | null;
  updated_at?: string | null;
}

export interface CreateNoteRequest {
  content: string;
}

export interface UpdateNoteRequest {
  content: string;
}

export interface ArchiveNoteRequest {
  archived: boolean;
}

export interface ReorderNotesRequest {
  noteIds: NoteId[];
}

export interface NoteMutationResponse {
  success: true;
}
