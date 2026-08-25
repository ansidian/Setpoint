# Notes Area Map

Desktop-only tldraw canvas. There is no legacy note model, editor, archive, search, or demo implementation.

- `NotesTab.tsx` — full-canvas states, recovery choice, and tldraw mount.
- `loadTldrawWorkspace.ts` — fresh server bootstrap plus local-recovery reconciliation on every mount.
- `tldrawAssetStore.ts` — authenticated content-addressed media uploads.
- `useTldrawAutosave.ts` — quiet-window server autosave, short-window local recovery, unload protection, coalescing, revision conflicts, and local session state.
- `tldrawRecoveryModel.ts` — validated recovery envelopes and server/local resolution policy.
- `tldrawRecoveryStore.ts` — serialized IndexedDB reads, writes, and exact-draft clearing.
- `ChecklistShapeUtil.tsx` — interactive checklist card rendering, keyboard behavior, resizing, accessibility, and SVG export.
- `ChecklistShapeCard.tsx` — the direct-manipulation checklist DOM and pointer/keyboard controls.
- `checklistShapeModel.ts` — validated custom-shape props, migrations, and immutable flat-row operations.
- `checklistTldrawConfig.tsx` — checklist creation tool and native toolbar registration.

The server snapshot contains only tldraw document records. An unsaved recovery envelope stays device-local in IndexedDB until that exact document is confirmed by the server; camera, active page, and other session state stay in localStorage. Do not add polling or realtime sync; another device sees changes after refresh.
