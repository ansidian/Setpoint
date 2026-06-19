const TAG_RE = /(?:^|\s)#([a-z0-9][\w-]*)/gi;

export function parseTags(content) {
  const out = [];
  const seen = new Set();
  for (const match of String(content || "").matchAll(TAG_RE)) {
    const tag = match[1].toLowerCase();
    if (!seen.has(tag)) { seen.add(tag); out.push(tag); }
  }
  return out;
}

export function collectTags(notes = []) {
  const seen = new Set();
  const out = [];
  for (const note of notes) {
    for (const tag of parseTags(note.content)) {
      if (!seen.has(tag)) { seen.add(tag); out.push(tag); }
    }
  }
  return out;
}

export function selectVisibleNotes({ notes = [], query = "", activeTag = null } = {}) {
  const q = query.trim().toLowerCase();
  const filtering = !!q || !!activeTag;
  let pool = filtering ? notes : notes.filter((n) => !n.archived_at);
  if (activeTag) pool = pool.filter((n) => parseTags(n.content).includes(activeTag));
  if (q) pool = pool.filter((n) => (n.content || "").toLowerCase().includes(q));
  return pool;
}

export function splitNoteForTask(content) {
  const lines = String(content || "").split("\n");
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return { title: "", description: "" };
  return {
    title: lines[firstIdx].trim(),
    description: lines.slice(firstIdx + 1).join("\n").trim(),
  };
}

export function formatNoteAge(createdAt, now = new Date()) {
  if (!createdAt) return "";
  // Accept both SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC, no tz) and a
  // JS ISO string ("...T...Z") — optimistic client writes use the latter, so we
  // must not double-append "Z" (which would yield NaN and a blank chip).
  const raw = String(createdAt).trim();
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const then = new Date(hasTz ? iso : `${iso}Z`);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor(Math.max(0, now.getTime() - then.getTime()) / 86400000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
