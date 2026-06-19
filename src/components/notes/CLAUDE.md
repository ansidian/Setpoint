# Notes Map

The Notes tab: a fourth shell tab for quick markdown jots with search, `#tag` filters, archive, and quiet promote-to-task. Entry point is `NotesTab.jsx` (mounted as a lazy `KeepAliveTab` by `DashboardShell`). Notes are stored as **plain markdown** in `ea_notes.content` — there is no rich-text/HTML storage.

## Files

### Tab + rows
- `NotesTab.jsx` — the tab surface: capture field (`NoteEditor`), client-side search, `#tag` filter chips, archive, drag-reorder, and promote mount. Owns the notes list state and optimistic CRUD.
- `NoteItem.jsx` — a sortable note row: markdown read view (`renderNoteMarkdown`), inline edit (`NoteEditor`), right-click + hover-kebab context menu (`NoteContextMenu`), drag handle, and `t`-to-promote.
- `NotesPromoteMount.jsx` — renders the floating Todoist `AddTaskPanel` pre-seeded from a note; archives the source note on a successful create.

### Editor (CodeMirror 6)
- `NoteEditor.jsx` — thin React wrapper around one CM6 `EditorView`, shared by the capture field and inline edit. Live-markdown preview, auto-expand (clamped), `#`-tag autocomplete. Value-controlled with a `lastEmittedRef` guard so it never re-dispatches CM's own edits.
- `noteEditorExtensions.js` — CM extensions: `livePreview` (hide markers off-cursor), `tagChips`, checkbox `WidgetType`/`checkboxes` plugin, `makeTagCompletionSource`, `noteTheme`, and `buildNoteEditorExtensions`. Also the pure `toggleCheckboxLine` util. CM lands in the lazy NotesTab chunk — keep it out of the entry bundle.

### Rendering + model (pure)
- `renderNoteMarkdown.jsx` — read-view markdown renderer for list rows (bold/italic/code/heading/`#tag` chips/links/checkboxes); links suppressed under demo mode.
- `notesModel.js` — `parseTags`, `collectTags`, `selectVisibleNotes`, `splitNoteForTask`, `formatNoteAge`.
- `notesUtils.jsx` — `linkifyText` (URL-only linkify; superseded in the tab by `renderNoteMarkdown`, retained for any other caller).
- `NoteContextMenu.jsx` — portal action menu (Edit / Add to Todoist / Archive / Delete) positioned at the cursor, viewport-clamped.

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- **One supported-markdown subset, two renderers.** The CM decorations in `noteEditorExtensions.js` and `renderNoteMarkdown.jsx` must render the same subset (bold, italic, inline code, heading, `#tag`, bare links, `- [ ] ` checkbox). The checkbox regex requires `]` + whitespace (`\]\s`) and is kept consistent across `renderNoteMarkdown`'s `CHECKBOX_RE`, `toggleCheckboxLine`, and the editor's `CHECK_LINE_RE` — a bare `- [x]` is intentionally NOT a checkbox.
- **`#tag` anchoring** matches `parseTags` (`#` only at start-or-whitespace) so a rendered chip is always a filterable tag.
- **Optimistic CRUD:** archive/update/reorder mutate local state first; the server write is fire-and-forget with an error log.
- **CM is lazy-only:** it's pulled in via the lazy `NotesTab` chunk; never import the editor from the entry path.

## Related

- `server/routes/notes.js` — notes CRUD + the `PATCH /:id/archive` endpoint.
- `src/components/dashboard/DashboardShell.jsx` — mounts `NotesTab` as a `KeepAliveTab` (key `4`).
- `src/components/todoist/AddTaskPanel.jsx` — promote target, pre-seeded via `initialInput`/`initialDescription`.
- `e2e/notes-editor.spec.js` — opt-in Playwright coverage for the editor (live markdown, autocomplete, checkbox persist).
