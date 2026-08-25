---
version: 1
slug: "src-components-notes-notestab-tsx"
primary_target: "src/components/notes/NotesTab.tsx"
related_targets: ["src/components/notes/useTldrawAutosave.ts","src/components/notes/tldrawAssetStore.ts","src/components/settings/ConnectionPanelContent.tsx"]
---

# Desktop Notes Canvas

- Scope and mode: the real authenticated desktop Notes tab; an Operate surface. Mobile and demo have no Notes entry or substitute.
- Audience and job: Setpoint's single owner needs one low-friction dumping ground for project features, bugs, plans, fleeting ideas, and personal reminders.
- Primary task: open Notes and immediately draw, type, organize native tldraw pages, add supported media, or capture a flat checkable plan in one movable card. Saving is ambient; only failures and revision conflicts demand action.
- Proof and content: tldraw's native infinite canvas, page controls, tools, styles, and media interactions remain the product. Setpoint adds one native-feeling Checklist shape plus license setup, compact save status, and explicit conflict recovery.
- Checklist interaction: rows wrap and grow for long ideas. Pointer reordering lifts the grabbed row, leaves a visible destination slot, and glides neighboring rows into place; losing pointer capture or releasing outside the moving grip must still settle the row immediately. `Alt+Arrow` is the keyboard equivalent. The existing check/add/remove/undo/export behavior remains intact.
- Save acknowledgement: `Saved` appears only after a real server document write and fades away after three seconds. Idle and unchanged canvases show no save pill. Device-local recovery remains ambient unless protection fails or the local/server revisions diverge.
- Constraints: one server document, one device-local IndexedDB recovery envelope, device-local camera/session state, desktop only, dark theme, refresh-based cross-device visibility, no polling/realtime/presence, no legacy model, no mobile placeholder, and restrained outbound traffic.
- Direction: a precise full-bleed tldraw work surface nested directly under Setpoint's dense shell. Preserve native tldraw interaction language; the Checklist tool joins the toolbar and behaves like a canvas shape rather than a detached task manager.
- Memorable moment: switching to Notes replaces the operational dashboard with a quiet, unconstrained black canvas while Setpoint's shell remains a narrow point of return.
- Unresolved decisions: none for the initial implementation; the owner will provide the production hobby license after deployment.
