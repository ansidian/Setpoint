import {
  NO_DEMO_API_RESPONSE,
  demoNotFound,
  demoPathSegment,
  type DemoApiRequest,
} from "./apiHandler.ts";
import type { DemoSeed } from "./store.ts";

const clone = <T>(value: T): T => value == null ? value : structuredClone(value);

export function handleDemoNotesRequest({ path, pathname, method, seed, body }: DemoApiRequest): unknown {
  if (pathname === "/api/notes" && method === "POST") {
    const note = {
      id: `demo-note-${Date.now()}`,
      user_id: "demo-user",
      content: body.content || "",
      sort_order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      archived_at: null,
    };
    seed.notes.unshift(note);
    seed.notes.forEach((entry, index) => { entry.sort_order = index + 1; });
    return clone(note);
  }

  if (pathname === "/api/notes/reorder" && method === "PATCH") {
    const order = Array.isArray(body.noteIds) ? body.noteIds.map(String) : [];
    const byId = new Map(seed.notes.map((note) => [String(note.id), note]));
    const ordered = order.map((id) => byId.get(id)).filter((note): note is DemoSeed["notes"][number] => Boolean(note));
    const remaining = seed.notes.filter((note) => !order.includes(String(note.id)));
    seed.notes = [...ordered, ...remaining];
    seed.notes.forEach((entry, index) => { entry.sort_order = index + 1; });
    return clone(seed.notes);
  }

  if (pathname.match(/^\/api\/notes\/[^/]+\/archive$/) && method === "PATCH") {
    const noteId = decodeURIComponent(demoPathSegment(pathname, 2));
    const note = seed.notes.find((entry) => String(entry.id) === String(noteId));
    if (!note) return demoNotFound(path);
    note.archived_at = body.archived ? new Date().toISOString() : null;
    note.updated_at = new Date().toISOString();
    return { success: true };
  }

  if (pathname.match(/^\/api\/notes\/[^/]+$/) && method === "PATCH") {
    const noteId = decodeURIComponent(demoPathSegment(pathname, 1));
    const note = seed.notes.find((entry) => String(entry.id) === String(noteId));
    if (!note) return demoNotFound(path);
    note.content = body.content ?? note.content;
    note.updated_at = new Date().toISOString();
    return clone(note);
  }

  if (pathname.match(/^\/api\/notes\/[^/]+$/) && method === "DELETE") {
    const noteId = decodeURIComponent(demoPathSegment(pathname, 1));
    seed.notes = seed.notes.filter((entry) => String(entry.id) !== String(noteId));
    return { ok: true };
  }

  if (pathname === "/api/notes" && method === "GET") return clone(seed.notes);
  return NO_DEMO_API_RESPONSE;
}

