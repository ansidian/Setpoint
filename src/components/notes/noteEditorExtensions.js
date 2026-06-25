import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { RangeSetBuilder, Prec, EditorSelection } from "@codemirror/state";
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

// Toggle a symmetric inline marker (`**`, `*`, `` ` ``) around every selection
// range — the primitive behind the Cmd/Ctrl+B/I/E hotkeys. Pure: takes a state,
// returns a transaction spec for state.update(). Behaviour per range:
//   - markers already hug the selection (just outside, or inside the selection) -> unwrap
//   - otherwise -> wrap; an empty selection inserts the pair and drops the caret between
export function toggleMarkerWrap(state, marker) {
  const ml = marker.length;
  return state.changeByRange((range) => {
    const { from, to } = range;
    const before = state.sliceDoc(Math.max(0, from - ml), from);
    const after = state.sliceDoc(to, Math.min(state.doc.length, to + ml));
    // markers sit just outside the selection -> strip them
    if (before === marker && after === marker) {
      return {
        changes: [{ from: from - ml, to: from }, { from: to, to: to + ml }],
        range: EditorSelection.range(from - ml, to - ml),
      };
    }
    const sel = state.sliceDoc(from, to);
    // selection already contains its own markers -> strip them
    if (sel.length >= 2 * ml && sel.startsWith(marker) && sel.endsWith(marker)) {
      return {
        changes: { from, to, insert: sel.slice(ml, sel.length - ml) },
        range: EditorSelection.range(from, to - 2 * ml),
      };
    }
    return {
      changes: { from, to, insert: marker + sel + marker },
      range: from === to
        ? EditorSelection.cursor(from + ml)
        : EditorSelection.range(from + ml, to + ml),
    };
  });
}

function wrapCommand(marker) {
  return (view) => {
    if (view.state.readOnly) return false;
    view.dispatch(view.state.update(toggleMarkerWrap(view.state, marker), {
      scrollIntoView: true,
      userEvent: "input.format",
    }));
    return true;
  };
}

// Pure: given the currently-selected text, return the [label](url) snippet to
// insert and the caret offset (relative to the snippet start) to drop the cursor.
//   - empty selection  -> "[]()", caret inside the [] so you type the label first
//   - selection is a URL -> "[](url)", caret inside the [] to type the label
//   - selection is text  -> "[text]()", caret inside the () to type the url
export function linkInsertion(selText) {
  const sel = selText || "";
  if (!sel) return { text: "[]()", caret: 1 };
  if (/^https?:\/\/\S+$/i.test(sel.trim())) return { text: `[](${sel})`, caret: 1 };
  const text = `[${sel}]()`;
  return { text, caret: text.length - 1 };
}

function linkCommand(view) {
  if (view.state.readOnly) return false;
  const tr = view.state.changeByRange((range) => {
    const { text, caret } = linkInsertion(view.state.sliceDoc(range.from, range.to));
    return {
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.cursor(range.from + caret),
    };
  });
  view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: "input.link" }));
  return true;
}

// Formatting hotkeys. Prec.high so they deterministically beat the defaultKeymap
// (Mod-i = selectParentSyntax) and historyKeymap — an intentional override; those
// commands are low value in a notes field. Mod-u is intentionally absent: markdown
// has no underline, and the rendered subset (renderNoteMarkdown.jsx) has no token
// for it. Mod-k inserts a [label](url) link. Mod- = Cmd on macOS, Ctrl elsewhere.
export const formattingKeymap = Prec.high(keymap.of([
  { key: "Mod-b", run: wrapCommand("**"), preventDefault: true },
  { key: "Mod-i", run: wrapCommand("*"), preventDefault: true },
  { key: "Mod-e", run: wrapCommand("`"), preventDefault: true },
  { key: "Mod-k", run: linkCommand, preventDefault: true },
]));

// Enter behavior on a checkbox line: continue the list, or exit on an empty item.
// Pure: given a line's text, returns null (not a checkbox), { type: "exit" }, or
// { type: "continue", insert } where `insert` is dropped at the cursor.
export function checkboxEnterAction(lineText) {
  const m = String(lineText).match(/^(\s*-\s\[(?: |x|X)\]\s)(.*)$/);
  if (!m) return null;
  if (m[2].trim() === "") return { type: "exit" };
  const indent = m[1].match(/^\s*/)[0];
  return { type: "continue", insert: `\n${indent}- [ ] ` };
}

// Auto-convert: a line-leading `[ ]` or `[]` (then a space) becomes a standard
// `- [ ] ` task, so notes stay portable GFM while the trigger stays intuitive.
// Pure: given the text from line-start to the cursor, returns null or { prefix }.
export function checkboxAutoConvert(beforeCursor) {
  const m = String(beforeCursor).match(/^(\s*)\[ ?\]$/);
  if (!m) return null;
  return { prefix: `${m[1]}- [ ] ` };
}

// Enter on a checkbox line. Single empty caret only — selections / multi-cursor
// fall through to the default (submit / newline).
function checkboxEnterCommand(view) {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const action = checkboxEnterAction(line.text);
  if (!action) return false;
  if (action.type === "exit") {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from }, userEvent: "delete", scrollIntoView: true });
  } else {
    view.dispatch({ changes: { from: range.head, insert: action.insert }, selection: { anchor: range.head + action.insert.length }, userEvent: "input", scrollIntoView: true });
  }
  return true;
}

// Space after a line-leading `[ ]`/`[]` → expand to `- [ ] `.
function checkboxConvertCommand(view) {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const conv = checkboxAutoConvert(state.sliceDoc(line.from, range.head));
  if (!conv) return false;
  view.dispatch({ changes: { from: line.from, to: range.head, insert: conv.prefix }, selection: { anchor: line.from + conv.prefix.length }, userEvent: "input", scrollIntoView: true });
  return true;
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
// In a [label](url) Link, hide the brackets/parens and the url off-cursor so just
// the styled label shows — the live-preview equivalent of renderNoteMarkdown's <a>.
const LINK_HIDE = new Set(["LinkMark", "URL"]);

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
            else if (node.name === "Link") ranges.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "cm-note-link" }) });
            if (MARKER_TYPES.has(node.name)) {
              const parent = node.node.parent;
              if (parent && !cursorInside(state, parent.from, parent.to)) {
                ranges.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
              }
            } else if (LINK_HIDE.has(node.name)) {
              const parent = node.node.parent;
              if (parent && parent.name === "Link" && !cursorInside(state, parent.from, parent.to)) {
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
    "&": { color: "var(--sp-text)", fontSize: "13px", background: "transparent" },
    // Match the notes search input's ::placeholder (.notes-search-input in index.css)
    // so both placeholders read identically; CM's base theme would otherwise use #888.
    ".cm-placeholder": { color: "var(--color-text-faint)" },
    ".cm-content": { fontFamily: "inherit", padding: "9px 12px", caretColor: "var(--sp-text)" },
    // Unclamped: the editor grows to fit content (long-backlog notes) and the
    // surrounding NotesTab scroll container owns the single outer scroll, instead
    // of a nested scrollbar inside a fixed-height editor. (maxHeight now unused.)
    ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.5" },
    "&.cm-focused": { outline: "none" },
    ".cm-note-strong": { fontWeight: "700" },
    ".cm-note-em": { fontStyle: "italic" },
    ".cm-note-code": { fontFamily: "ui-monospace, monospace", background: "rgba(255,255,255,0.06)", borderRadius: "4px", padding: "0 3px" },
    ".cm-note-heading": { fontWeight: "700" },
    ".cm-note-link": { color: "var(--ea-accent, var(--sp-accent))", textDecoration: "underline", textUnderlineOffset: "2px" },
    ".cm-note-tag": { color: "var(--ea-accent, var(--sp-accent))", background: "color-mix(in srgb, var(--sp-accent) 12%, transparent)", borderRadius: "999px", padding: "0 4px" },
    ".cm-tooltip-autocomplete": { background: "color-mix(in srgb, var(--sp-mantle) 98%, transparent)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "8px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "color-mix(in srgb, var(--sp-accent) 16%, transparent)", color: "var(--sp-text)" },
  });
}

// Re-export the CM symbols the assembler/wrapper need so callers import from one module.
export { EditorView, keymap, Prec, cmPlaceholder, autocompletion, completionStatus, history, historyKeymap, defaultKeymap, markdown, WidgetType, Decoration, RangeSetBuilder, ViewPlugin };

// Checkbox widget: renders an <input type=checkbox> that toggles one marker char
// in the document by absolute position on mousedown. The regex requires `]` + whitespace
// so it matches the SAME well-formed checkboxes as renderNoteMarkdown and toggleCheckboxLine.
class CheckboxWidget extends WidgetType {
  constructor(checked, markerPos) { super(); this.checked = checked; this.markerPos = markerPos; }
  // Compare markerPos too: when an edit above shifts this line, the rebuilt widget
  // gets a new markerPos, so CM recreates the DOM (and the mousedown closure) — a
  // stale closure can never dispatch a change at the wrong position.
  eq(other) { return other.checked === this.checked && other.markerPos === this.markerPos; }
  toDOM(view) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.style.cssText = "margin:0 4px 0 0;vertical-align:middle;accent-color:var(--sp-accent);cursor:pointer";
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const insert = this.checked ? " " : "x";
      view.dispatch({ changes: { from: this.markerPos, to: this.markerPos + 1, insert } });
    });
    return box;
  }
  ignoreEvent() { return false; }
}

// Matches well-formed checkbox lines: `- [ ] ` or `- [x] ` (space after `]` required).
// Groups: m[1]=`\s*-\s[`  m[2]=` |x|X`  m[3]=`] ` (two chars)
const CHECK_LINE_RE = /^(\s*-\s\[)( |x|X)(\]\s)/;

export const checkboxes = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = this.build(view); }
    update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
    build(view) {
      const builder = new RangeSetBuilder();
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          const m = line.text.match(CHECK_LINE_RE);
          if (m) {
            const markerPos = line.from + m[1].length;          // the space/x char
            const checked = m[2].toLowerCase() === "x";
            builder.add(
              line.from + m[1].length - 1,                      // the "[" char
              line.from + m[1].length + 2,                      // exclusive end past "]"; the trailing space stays in the doc

              Decoration.replace({ widget: new CheckboxWidget(checked, markerPos) }),
            );
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// Assembles the full extension list for a NoteEditor instance.
// callbacksRef.current = { onChange, onSubmit, onCancel, submitOnEnter, getTags }
export function buildNoteEditorExtensions({ callbacksRef, placeholderText, maxHeight }) {
  const submitKeymap = Prec.highest(keymap.of([
    {
      key: "Enter",
      run: (view) => {
        if (completionStatus(view.state) === "active") return false; // let autocomplete accept
        if (checkboxEnterCommand(view)) return true; // continue / exit a checkbox list
        const { submitOnEnter, onSubmit } = callbacksRef.current;
        if (!submitOnEnter) return false; // fall through to newline
        onSubmit?.(view.state.doc.toString());
        return true;
      },
    },
    { key: "Shift-Enter", run: () => false }, // default newline
    { key: "Space", run: checkboxConvertCommand }, // `[ ]` + space → `- [ ] `
    { key: "Escape", run: () => { callbacksRef.current.onCancel?.(); return true; } },
  ]));

  return [
    history(),
    markdown(),
    EditorView.lineWrapping,
    livePreview,
    tagChips,
    checkboxes,
    autocompletion({ override: [makeTagCompletionSource(() => callbacksRef.current.getTags?.() || [])] }),
    submitKeymap,
    formattingKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    cmPlaceholder(placeholderText || ""),
    noteTheme(maxHeight),
    EditorView.updateListener.of((u) => { if (u.docChanged) callbacksRef.current.onChange?.(u.state.doc.toString()); }),
  ];
}
