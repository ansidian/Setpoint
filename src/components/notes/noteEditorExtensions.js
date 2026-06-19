import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { RangeSetBuilder, Prec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion, completionStatus } from "@codemirror/autocomplete";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";

// Toggle the Nth `- [ ] / - [x]` line in `content`. Returns new content.
export function toggleCheckboxLine(content, index) {
  const lines = String(content || "").split("\n");
  let seen = -1;
  for (let i = 0; i < lines.length; i += 1) {
    // Require `]` + whitespace so this counts the SAME well-formed checkboxes
    // renderNoteMarkdown renders (a bare `- [x]` is not a togglable checkbox).
    const m = lines[i].match(/^(\s*-\s\[)( |x|X)(\]\s.*)$/);
    if (!m) continue;
    seen += 1;
    if (seen === index) {
      const next = m[2].toLowerCase() === "x" ? " " : "x";
      lines[i] = `${m[1]}${next}${m[3]}`;
      break;
    }
  }
  return lines.join("\n");
}

// Autocomplete source: fires inside a `#token`, offers existing tags by prefix.
// Free tags are still allowed (typing past the menu creates a new tag).
export function makeTagCompletionSource(getTags) {
  return (context) => {
    const token = context.matchBefore(/#[\w-]*/);
    if (!token) return null;
    if (token.from === token.to && !context.explicit) return null;
    const typed = token.text.slice(1).toLowerCase();
    const options = (getTags() || [])
      .filter((t) => t.toLowerCase().startsWith(typed))
      .map((t) => ({ label: `#${t}`, type: "constant" }));
    if (!options.length) return null;
    return { from: token.from, to: token.to, options, validFor: /^#[\w-]*$/ };
  };
}

// Marker tokens hidden when the cursor is OUTSIDE their parent node.
const MARKER_TYPES = new Set(["EmphasisMark", "CodeMark", "HeaderMark"]);
const STYLED_PARENTS = { StrongEmphasis: "cm-note-strong", Emphasis: "cm-note-em", InlineCode: "cm-note-code" };
const HEADING_TYPES = new Set(["ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6"]);

function cursorInside(state, from, to) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = this.build(view); }
    update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view); }
    build(view) {
      const ranges = [];
      const { state } = view;
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from, to,
          enter: (node) => {
            const cls = STYLED_PARENTS[node.name];
            if (cls) ranges.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: cls }) });
            else if (HEADING_TYPES.has(node.name)) ranges.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "cm-note-heading" }) });
            if (MARKER_TYPES.has(node.name)) {
              const parent = node.node.parent;
              if (parent && !cursorInside(state, parent.from, parent.to)) {
                ranges.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
              }
            }
          },
        });
      }
      // RangeSetBuilder requires ascending `from`, then ascending startSide
      // (a `mark` and a `replace` at the same position differ by side).
      ranges.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
      const builder = new RangeSetBuilder();
      for (const r of ranges) builder.add(r.from, r.to, r.deco);
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// #tag chips via a matchAll pass over visible text (not a markdown node).
const TAG_RE = /(?:^|\s)#([a-z0-9][\w-]*)/gi;
export const tagChips = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = this.build(view); }
    update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
    build(view) {
      const ranges = [];
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.sliceDoc(from, to);
        for (const m of text.matchAll(TAG_RE)) {
          const lead = m[0].length - (m[1].length + 1); // leading space, if any
          const start = from + m.index + lead;
          ranges.push({ from: start, to: start + m[1].length + 1 });
        }
      }
      ranges.sort((a, b) => a.from - b.from);
      const builder = new RangeSetBuilder();
      for (const r of ranges) builder.add(r.from, r.to, Decoration.mark({ class: "cm-note-tag" }));
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

export function noteTheme(maxHeight) {
  return EditorView.theme({
    "&": { color: "#cdd6f4", fontSize: "13px", background: "transparent" },
    ".cm-content": { fontFamily: "inherit", padding: "9px 12px", caretColor: "#cdd6f4" },
    ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.5", overflowY: "auto", maxHeight: `${maxHeight || 180}px` },
    "&.cm-focused": { outline: "none" },
    ".cm-note-strong": { fontWeight: "700" },
    ".cm-note-em": { fontStyle: "italic" },
    ".cm-note-code": { fontFamily: "ui-monospace, monospace", background: "rgba(255,255,255,0.06)", borderRadius: "4px", padding: "0 3px" },
    ".cm-note-heading": { fontWeight: "700" },
    ".cm-note-tag": { color: "var(--ea-accent, #cba6da)", background: "rgba(203,166,218,0.12)", borderRadius: "999px", padding: "0 4px" },
    ".cm-tooltip-autocomplete": { background: "rgba(24,24,37,0.98)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "8px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "rgba(203,166,218,0.16)", color: "#cdd6f4" },
  });
}

// Re-export the CM symbols the assembler/wrapper need so callers import from one module.
export { EditorView, keymap, Prec, cmPlaceholder, autocompletion, completionStatus, history, historyKeymap, defaultKeymap, markdown, WidgetType, Decoration, RangeSetBuilder, ViewPlugin };

// Assembles the full extension list for a NoteEditor instance.
// callbacksRef.current = { onChange, onSubmit, onCancel, submitOnEnter, getTags }
export function buildNoteEditorExtensions({ callbacksRef, placeholderText, maxHeight }) {
  const submitKeymap = Prec.highest(keymap.of([
    {
      key: "Enter",
      run: (view) => {
        if (completionStatus(view.state) === "active") return false; // let autocomplete accept
        const { submitOnEnter, onSubmit } = callbacksRef.current;
        if (!submitOnEnter) return false; // fall through to newline
        onSubmit?.(view.state.doc.toString());
        return true;
      },
    },
    { key: "Shift-Enter", run: () => false }, // default newline
    { key: "Escape", run: () => { callbacksRef.current.onCancel?.(); return true; } },
  ]));

  return [
    history(),
    markdown(),
    EditorView.lineWrapping,
    livePreview,
    tagChips,
    autocompletion({ override: [makeTagCompletionSource(() => callbacksRef.current.getTags?.() || [])] }),
    submitKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    cmPlaceholder(placeholderText || ""),
    noteTheme(maxHeight),
    EditorView.updateListener.of((u) => { if (u.docChanged) callbacksRef.current.onChange?.(u.state.doc.toString()); }),
  ];
}
