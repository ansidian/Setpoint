import type { Note, NotesView } from "../../../shared/types/notes.ts";

const TAG_RE = /(?:^|\s)#([a-z0-9][\w-]*)/gi;

type NoteContent = Pick<Note, "content">;
type VisibleNote = NoteContent & Partial<Pick<Note, "archived_at">>;

export function parseTags(content: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of String(content || "").matchAll(TAG_RE)) {
    const tag = match[1]!.toLowerCase();
    if (!seen.has(tag)) { seen.add(tag); out.push(tag); }
  }
  return out;
}

export function collectTags(notes: NoteContent[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const note of notes) {
    for (const tag of parseTags(note.content)) {
      if (!seen.has(tag)) { seen.add(tag); out.push(tag); }
    }
  }
  return out;
}

// view: "active" (default) shows un-archived notes; "archived" shows archived ones.
// Search and tag filters apply WITHIN the selected view so each view is self-contained.
export function selectVisibleNotes<T extends VisibleNote>({
  notes = [] as T[],
  query = "",
  activeTag = null,
  view = "active",
}: {
  notes?: T[];
  query?: string;
  activeTag?: string | null;
  view?: NotesView;
} = {}): T[] {
  const q = query.trim().toLowerCase();
  let pool = notes.filter((n) => (view === "archived" ? !!n.archived_at : !n.archived_at));
  if (activeTag) pool = pool.filter((n) => parseTags(n.content).includes(activeTag));
  if (q) pool = pool.filter((n) => (n.content || "").toLowerCase().includes(q));
  return pool;
}

export function splitNoteForTask(content: unknown): { title: string; description: string } {
  const lines = String(content || "").split("\n");
  const firstIdx = lines.findIndex((line) => line.trim().length > 0);
  if (firstIdx === -1) return { title: "", description: "" };
  return {
    title: lines[firstIdx]!.trim(),
    description: lines.slice(firstIdx + 1).join("\n").trim(),
  };
}

// Accept both SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC, no tz) and a
// JS ISO string ("...T...Z") — optimistic client writes use the latter, so we
// must not double-append "Z" (which would yield NaN). Returns a Date or null.
export function parseNoteDate(value: unknown): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ageLabel(then: Date, now: Date): string {
  const days = Math.floor(Math.max(0, now.getTime() - then.getTime()) / 86400000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function formatNoteAge(createdAt: unknown, now = new Date()): string {
  const then = parseNoteDate(createdAt);
  return then ? ageLabel(then, now) : "";
}

// "edited Nago" label for a note changed meaningfully after creation. created_at
// (SQLite) and updated_at (ISO from optimistic writes) can be different formats,
// so compare parsed Dates, never strings. A sub-minute delta is the initial write,
// not a real edit, so it returns null (no "edited" label on fresh notes).
export function noteEditedAge(
  note: Partial<Pick<Note, "created_at" | "updated_at">> | null | undefined,
  now = new Date(),
): string | null {
  const created = parseNoteDate(note?.created_at);
  const updated = parseNoteDate(note?.updated_at);
  if (!created || !updated) return null;
  if (updated.getTime() - created.getTime() < 60000) return null;
  return ageLabel(updated, now);
}

// Remove anchored #tags from note text so they can be surfaced once as footer
// chips instead of inline. Mirrors parseTags anchoring (a mid-word "issue#123" is
// preserved) and keeps the line count stable so checkbox indices still line up
// with the original content.
export function stripTags(content: unknown): string {
  return String(content || "")
    .split("\n")
    .map((line) => line
      .replace(/(?<!\S)#[a-z0-9][\w-]*/gi, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+$/g, ""))
    .join("\n");
}
