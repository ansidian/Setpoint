# Notes Area Map

Desktop-only tldraw canvas. There is no legacy note model, editor, archive, search, or demo implementation.

- `NotesTab.tsx` — bootstrap, full-canvas states, conflict recovery, and tldraw mount.
- `tldrawAssetStore.ts` — authenticated content-addressed media uploads.
- `useTldrawAutosave.ts` — quiet-window autosave, coalescing, revision conflicts, and local session state.
- `ChecklistShapeUtil.tsx` — interactive checklist card rendering, keyboard behavior, resizing, accessibility, and SVG export.
- `ChecklistShapeCard.tsx` — the direct-manipulation checklist DOM and pointer/keyboard controls.
- `checklistShapeModel.ts` — validated custom-shape props, migrations, and immutable flat-row operations.
- `checklistTldrawConfig.tsx` — checklist creation tool and native toolbar registration.

The persisted server snapshot contains only tldraw document records. Camera, active page, and other session state stay device-local. Do not add polling or realtime sync; another device sees changes after refresh.
