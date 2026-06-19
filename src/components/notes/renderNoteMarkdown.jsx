import { isDemoMode } from "../../demo/config.js";

// inline tokens, first match wins per scan position; global flag is required by matchAll.
// The #tag branch uses a (?<!\S) lookbehind so only start-or-whitespace-anchored
// tags become chips — matching parseTags() in notesModel.js (so a "#" mid-word like
// issue#123 is plain text, not a chip that wouldn't actually filter).
const INLINE_RE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|(?<!\S)#([a-z0-9][\w-]*)|https?:\/\/[^\s]+)/gi;

function inlineNodes(text, accent, keyBase) {
  const out = [];
  let last = 0;
  let i = 0;
  for (const m of String(text).matchAll(INLINE_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[2] != null) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3] != null) out.push(<strong key={k}>{m[3]}</strong>);
    else if (m[4] != null) out.push(<em key={k}>{m[4]}</em>);
    else if (m[5] != null) out.push(<em key={k}>{m[5]}</em>);
    else if (m[6] != null) out.push(
      <code key={k} style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.92em", background: "rgba(255,255,255,0.06)", padding: "0 4px", borderRadius: 4 }}>{m[6]}</code>,
    );
    else if (m[7] != null) out.push(
      <span key={k} data-note-tag={m[7].toLowerCase()} style={{ color: accent || "var(--ea-accent, #cba6da)", background: "rgba(203,166,218,0.12)", borderRadius: 999, padding: "1px 6px", fontSize: "0.92em" }}>#{m[7]}</span>,
    );
    else if (m[0].startsWith("http")) {
      out.push(isDemoMode()
        ? m[0]
        : <a key={k} href={m[0]} target="_blank" rel="noopener noreferrer" style={{ color: accent || "var(--ea-accent, #cba6da)", textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>{m[0]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const CHECKBOX_RE = /^(\s*)-\s\[( |x|X)\]\s(.*)$/;

export function renderNoteMarkdown(content, { accent, onToggleCheckbox } = {}) {
  const lines = String(content || "").split("\n");
  let checkboxIndex = -1;
  return lines.map((line, li) => {
    const cb = line.match(CHECKBOX_RE);
    if (cb) {
      checkboxIndex += 1;
      const idx = checkboxIndex;
      const checked = cb[2].toLowerCase() === "x";
      return (
        <div key={li} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
          <input
            type="checkbox"
            checked={checked}
            aria-label={cb[3]}
            onChange={() => onToggleCheckbox?.(idx)}
            onClick={(e) => e.stopPropagation()}
            style={{ marginTop: 3, accentColor: accent || "#cba6da", cursor: "pointer" }}
          />
          <span style={{ textDecoration: checked ? "line-through" : "none", opacity: checked ? 0.6 : 1 }}>
            {inlineNodes(cb[3], accent, `${li}`)}
          </span>
        </div>
      );
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      return (
        <div key={li} style={{ fontWeight: 700, fontSize: heading[1].length <= 2 ? "1.08em" : "1em", margin: "1px 0" }}>
          {inlineNodes(heading[2], accent, `${li}`)}
        </div>
      );
    }
    return <div key={li}>{inlineNodes(line, accent, `${li}`)}</div>;
  });
}
