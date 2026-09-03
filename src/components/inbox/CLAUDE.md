# Inbox Map

The email triage and reading surface, desktop and mobile: active snapshots (triage windows), an initial-load live fallback, indexed search, snooze/undo, and the reader pane. Entry points are `InboxView.tsx` (orchestrator) and `useInboxController.ts` (central state machine); `reader/Reader.tsx` routes the detail pane. On desktop, AI questions about mail hand off to Alfred (⌘Enter / Sparkles open the Alfred Panel with the query — no in-inbox AI answer surface). Mobile exposes no Alfred entry point.

## Sub-maps

- `reader/` — desktop/mobile detail pane, bodies, triage, bill and transaction-import actions (see `reader/CLAUDE.md`)

## Files

### Views + orchestration
- `InboxView.tsx` — composes active/historical snapshot modes and the initial-load live fallback, session state, undo coordination
- `InboxDesktopPane.tsx` — desktop layout: digest, sidebar, list, reader, undo toast
- `inboxViewTypes.ts` — shared top-level desktop/mobile pane composition contract
- `useInboxController.ts` — central state machine: selection, filters, search, undo, desktop Alfred handoff
- `inboxReadRoutingModel.ts` — read-scope routing (`resolveReadScope`) + `planMarkAllVisibleRead`; one home for the live/snapshot/indexed decision shared by mark-all and auto-mark-read
- `useInboxActionDispatch.ts` — action handlers: trash, snooze, lane move, mark read, draft reply
- `useInboxSessionState.ts` — external session store surviving unmount/tab switches
- `useSnapshotOptimisticOverlay.ts` — reconciles optimistic overlays against snapshot refreshes
- `useInboxUndoSlot.ts` — undo slot lifecycle: timer, pending, commit/settle

### List + rows
- `InboxList.tsx` — desktop list container: skeletons, search, lane filters, Alfred handoff (⌘Enter)
- `InboxLaneFilterBar.tsx` — compact desktop lane scope with non-empty, lane-tinted count chips
- `LaneSection.tsx` — memoized swimlane lane section: sticky header + collapsible row body
- `EmailRow.tsx` — single email row: avatar, preview, urgency/lane bar
- `InboxRowTransition.tsx` — desktop row/lane entry and exit shell; retains departing content as inert while its space closes
- `DigestStrip.tsx` — header strip: snapshot status, lane counts, processing activity
- `DesktopSnapshotNavigator.tsx` — desktop list-local snapshot context, adjacent navigation, and active update status
- `SnapshotNavigationControls.tsx` — shared desktop/mobile adjacent-snapshot controls with boundary, loading, and error states
- `Sidebar.tsx` — collapsible desktop account navigation and shortcut reference
- `sidebarCompactStore.ts` — persisted read/write/default for the inbox sidebar compact toggle (key `ea:inboxSidebarCompact`)
- `inboxRow.ts` — canonical row normalization: field fallbacks, read-override merge
- `inboxWorkItems.ts` — work item pipelines: active-snapshot, initial-load live fallback, and resurfaced-snooze
- `inboxVisibleEmailsModel.ts` — `selectVisibleEmails`: the rendered-row projection (indexed-search short-circuit + snooze/account/lane filter + lane/recency sort)
- `inboxCountsModel.ts` — scoped unread counts under account filters, plus lane/mobile-chip/unread count projections
- `inboxNowTick.ts` — schedules the `nowTick` timeout to the soonest snooze or verification-code boundary
- `inboxProcessingModel.ts` — triage activity counts from processing state
- `snapshotSummary.ts` — lane breakdown and snapshot-window orientation text for Inbox headers
- `activeSnapshotWorkflowModel.ts` — lane routing, mutable/dismissible rules, reopen logic
- `inboxCommandModel.ts` — builds trash/lane-move commands per email scope
- `inboxTypes.ts` — canonical Inbox account, identity, row/work-item, filter, overlay, and selection contracts

### Filters + search
- `InboxSearchFlagChips.tsx` — is:unread toggle chip
- `InboxSearchFlagChipsModel.ts` — parses/toggles is:read|is:unread flags in queries
- `indexedSearchModel.ts` — normalizes indexed search results, merges read state
- `useIndexedSearch.ts` — debounced indexed-search hook: query effect, stale-response guard, local read-override reconciliation (`updateIndexedSearchRead`/`markIndexedSearchReadBulk`)

### Mobile
- `mobile/MobileInboxView.tsx` — mobile layout: chip filter bar, compact rows, reader
- `mobile/MobileSnapshotHeader.tsx` — mobile snapshot summary, historical orientation, and adjacent navigation
- `mobile/MobileFilterSheet.tsx` — dismissible account/lane filter sheet

### Snooze, undo, hotkeys
- `SnoozePicker.tsx` — floating date/time picker anchored to the snooze button
- `InboxUndoToast.tsx` — bottom-center undo toast
- `inboxHotkeys.ts` — key → action resolution per workflow (snapshot vs live fallback)
- `useInboxKeyboardCommands.ts` — window hotkeys: undo, search focus, j/k nav, actions

### Shared
- `helpers.ts` — time formatters and snooze preset builder
- `primitives.tsx` — Kbd, Avatar, Eyebrow, StickyHeader, LaneIcon, QuickAction
- `test-utils/inboxFixtures.ts` — email/account test factories

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Optimistic UI: snapshot mutations apply overlays immediately and reconcile on refresh.
- Session state lives outside React (external store) so tab switches don't reset triage position.
- Lane-based classification drives both filtering and hotkey behavior; lane rules live in `activeSnapshotWorkflowModel.ts`.

## Related

- `server/routes/briefing/` — email/snapshot endpoints this UI calls
- `src/lib/triageSoundGate.ts` — sound dedup gate for triage events
- `src/components/alfred/` — desktop-only Alfred Panel; receives the desktop inbox ⌘Enter / Sparkles handoff
- `reader/` — detail-pane sub-area (see its map)
