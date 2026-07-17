# Notes Map

The Notes tab: a fourth shell tab for quick markdown jots with search, `#tag` filters, an Active/Archived view toggle, and quiet promote-to-task. Entry point is `NotesTab.tsx` (mounted as a lazy `KeepAliveTab` by `DashboardShell`). Notes are stored as **plain markdown** in `ea_notes.content` — there is no rich-text/HTML storage.

## Files

### Tab + rows
- `NotesTab.tsx` — the tab surface: capture field (`NoteEditor`), client-side search, `#tag` filter chips, an Active/Archived `ViewToggle`, drag-reorder (active view only), and promote mount. Owns the notes list state and optimistic CRUD (edit also bumps `updated_at` so the "edited" label isn't stale). One-or-many helpers `deleteNotes(ids)` / `setArchived(ids, archived, {silent})` back both single and bulk actions; archive/delete/unarchive surface a `NotesToast` with Undo; **delete is deferred** — rows leave immediately but the server `deleteNote`s are held for the undo window and committed on timeout / page-hide / unmount (`pendingDeleteRef` holds `{ ids }`, `flushPendingDelete` drains it), so Undo restores in place with no re-create. **Batch selection (no entry affordance):** Cmd/Ctrl+click a row toggles it into a `selected` Set; right-clicking a selected row opens a bulk menu (Archive/Delete N), a plain click clears the selection, Cmd/Ctrl+A selects all visible (the keydown effect only subscribes while a selection exists, and `<Activity>` tears it down when the tab is hidden, so it can't hijack select-all elsewhere). Switching view clears the selection. Richer empty state when no notes exist.
- `NoteItem.tsx` — a sortable note row: markdown read view (`renderNoteMarkdown` on `stripTags`'d content), inline edit (`NoteEditor`), right-click + hover-kebab context menu (`NoteContextMenu`), drag handle, and `t`-to-promote. Shows a persistent muted age (top-right) and a footer with `#tag` chips + an "edited Nago" label (`noteEditedAge`). Hover lift via the `.note-row` class (box-shadow only — the row owns dnd-kit's inline `transform`). `draggable=false` (archived view OR batch mode) disables sort + hides the handle; gets `onArchive` in the active view, `onUnarchive` in the archived view. `selected` styles the row (accent border/tint); `onToggleSelect`/`onClearSelection` drive Cmd-click select / plain-click clear; when selected, the menu switches to the bulk handlers (`onBulkArchive`/`onBulkUnarchive`/`onBulkDelete`) with the selection `count`.
- `NotesToast.tsx` — bottom-center toast for the Notes tab; kind (`archive`/`delete`/`restore`) drives icon + color so the actions read differently, with an optional Undo button.
- `NotesPromoteMount.tsx` — renders the floating Todoist `AddTaskPanel` pre-seeded from a note; archives the source note on a successful create.

### Editor (CodeMirror 6)
- `NoteEditor.tsx` — thin React wrapper around one CM6 `EditorView`, shared by the capture field and inline edit. Live-markdown preview, auto-expand (clamped), `#`-tag autocomplete. Value-controlled with a `lastEmittedRef` guard so it never re-dispatches CM's own edits. A `destroyingRef` guard swallows the `blur` that `view.destroy()` emits during teardown (incl. StrictMode's mount→cleanup→mount) — without it, inline edit committed+closed instantly and Escape-cancel re-fired as a commit.
- `noteEditorExtensions.ts` — CM extensions: `livePreview` (hide bold/italic/code/heading/**link** markers off-cursor), `tagChips`, checkbox `WidgetType`/`checkboxes` plugin, `makeTagCompletionSource`, `formattingKeymap` (Cmd/Ctrl+B/I/E wrap-toggle via `toggleMarkerWrap`, Cmd/Ctrl+K link via `linkInsertion`; `Prec.high` to win the Mod-i default-keymap collision), `noteTheme`, and `buildNoteEditorExtensions`. Checkbox ergonomics live in the `Prec.highest` submit keymap: **Space** auto-converts a line-leading `[ ]`/`[]` to `- [ ] ` (`checkboxAutoConvert`); **Enter** continues a checkbox list / exits on an empty item (`checkboxEnterAction`) BEFORE the submit-on-Enter check, so finishing a checkbox note is Enter-on-empty (exit) then Enter (submit). Also the pure `toggleCheckboxLine` util. CM lands in the lazy NotesTab chunk — keep it out of the entry bundle.

### Rendering + model (pure)
- `renderNoteMarkdown.tsx` — read-view markdown renderer for list rows (bold/italic/code/heading/`#tag` chips/bare links/`[label](url)` links/checkboxes); links suppressed under demo mode. Markdown-link URLs are restricted to `http(s)` so `[x](javascript:…)` can never render as a live `<a>`.
- `notesModel.ts` — `parseTags`, `collectTags`, `selectVisibleNotes` (takes a `view: "active"|"archived"`; search/tag filters apply within the view), `splitNoteForTask`, `parseNoteDate`, `formatNoteAge`, `noteEditedAge` (created-vs-updated, Date-compared across formats), `stripTags` (remove anchored tags from a body, line-count-stable so checkbox indices hold).
- `notesUtils.tsx` — `linkifyText` (URL-only linkify; superseded in the tab by `renderNoteMarkdown`, retained for any other caller).
- `NoteContextMenu.tsx` — portal action menu (Edit / Add to Todoist / Archive **or** Unarchive / Delete) positioned at the cursor, viewport-clamped. Renders Archive when given `onArchive`, Unarchive when given `onUnarchive`. A `count > 1` suffixes the action labels ("Archive 3", "Delete 3") for the bulk menu (the bulk caller omits Edit/Promote).

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- **One supported-markdown subset, two renderers.** The CM decorations in `noteEditorExtensions.ts` and `renderNoteMarkdown.tsx` must render the same subset (bold, italic, inline code, heading, `#tag`, bare links, `[label](url)` links, `- [ ] ` checkbox). The checkbox regex requires `]` + whitespace (`\]\s`) and is kept consistent across `renderNoteMarkdown`'s `CHECKBOX_RE`, `toggleCheckboxLine`, and the editor's `CHECK_LINE_RE` — a bare `- [x]` is intentionally NOT a checkbox.
- **`#tag` anchoring** matches `parseTags` (`#` only at start-or-whitespace) so a rendered chip is always a filterable tag.
- **Optimistic CRUD:** archive/update/reorder/unarchive mutate local state first; the server write is fire-and-forget with an error log. **Delete is the exception** — it's deferred (see `NotesTab.tsx`) so Undo can cancel the server call entirely.
- **CM is lazy-only:** it's pulled in via the lazy `NotesTab` chunk; never import the editor from the entry path.

## Related

- `server/routes/notes.ts` — notes CRUD + the `PATCH /:id/archive` endpoint.
- `src/components/dashboard/DashboardShell.jsx` — mounts `NotesTab` as a `KeepAliveTab` (key `4`).
- `src/components/todoist/AddTaskPanel.jsx` — promote target, pre-seeded via `initialInput`/`initialDescription`.
- `e2e/notes-editor.spec.js` — opt-in Playwright coverage for the editor (live markdown, autocomplete, checkbox persist).
