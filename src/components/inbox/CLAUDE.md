# Inbox Map

The email triage and reading surface, desktop and mobile: live-polled email, active snapshots (triage windows), indexed search, snooze/undo, and the reader pane. Entry points are `InboxView.tsx` (orchestrator) and `useInboxController.ts` (central state machine); `reader/Reader.tsx` routes the detail pane. AI questions about mail hand off to Alfred (⌘Enter / Sparkles open the Alfred Panel with the query — no in-inbox AI answer surface).

## Sub-maps

- `reader/` — desktop/mobile detail pane, bodies, triage, bill and transaction-import actions (see `reader/CLAUDE.md`)

## Files

### Views + orchestration
- `InboxView.tsx` — composes live/snapshot modes, session state, undo coordination
- `InboxDesktopPane.tsx` — desktop layout: digest, sidebar, list, reader, undo toast
- `inboxViewTypes.ts` — shared top-level desktop/mobile pane composition contract
- `useInboxController.ts` — central state machine: selection, filters, search, undo, Alfred handoff
- `inboxReadRoutingModel.ts` — read-scope routing (`resolveReadScope`) + `planMarkAllVisibleRead`; one home for the live/snapshot/indexed decision shared by mark-all and auto-mark-read
- `useInboxActionDispatch.ts` — action handlers: trash, snooze, lane move, mark read, draft reply
- `useInboxSessionState.ts` — external session store surviving unmount/tab switches
- `useSnapshotOptimisticOverlay.ts` — reconciles optimistic overlays against snapshot refreshes
- `useInboxUndoSlot.ts` — undo slot lifecycle: timer, pending, commit/settle

### List + rows
- `InboxList.tsx` — list container: skeletons, search, filter chips, Alfred handoff (⌘Enter)
- `LaneSection.tsx` — memoized swimlane lane section: sticky header + collapsible row body
- `EmailRow.tsx` — single email row: avatar, preview, urgency/lane bar
- `DigestStrip.tsx` — header strip: live/snapshot status, lane counts, processing activity
- `Sidebar.tsx` — account and lane navigation
- `sidebarCompactStore.ts` — persisted read/write/default for the inbox sidebar compact toggle (key `ea:inboxSidebarCompact`)
- `inboxRow.ts` — canonical row normalization: field fallbacks, read-override merge
- `inboxWorkItems.ts` — work item pipelines: active-snapshot, live, resurfaced-snooze
- `inboxVisibleEmailsModel.ts` — `selectVisibleEmails`: the rendered-row projection (indexed-search short-circuit + snooze/account/category/lane filter + untriaged/lane/recency sort)
- `inboxCountsModel.ts` — scoped unread counts under account/category filters, plus lane/live/mobile-chip/unread count projections
- `inboxNowTick.ts` — schedules the `nowTick` timeout to the soonest snooze boundary or grace-label transition
- `inboxProcessingModel.ts` — triage activity counts from processing state
- `snapshotSummary.ts` — lane breakdown text for the digest header
- `activeSnapshotWorkflowModel.ts` — lane routing, mutable/dismissible rules, reopen logic
- `inboxCommandModel.ts` — builds trash/lane-move commands per email scope
- `inboxTypes.ts` — canonical Inbox account, identity, row/work-item, filter, overlay, and selection contracts

### Filters + search
- `InboxCategoryFilterChips.tsx` — category chip menu with overflow dropdown
- `InboxCategoryFilterChipsModel.ts` — category ordering: critical > commitment > passive
- `InboxSearchFlagChips.tsx` — is:unread toggle chip
- `InboxSearchFlagChipsModel.ts` — parses/toggles is:read|is:unread flags in queries
- `indexedSearchModel.ts` — normalizes indexed search results, merges read state
- `useIndexedSearch.ts` — debounced indexed-search hook: query effect, stale-response guard, local read-override reconciliation (`updateIndexedSearchRead`/`markIndexedSearchReadBulk`)

### Mobile
- `mobile/MobileInboxView.tsx` — mobile layout: chip filter bar, compact rows, reader
- `mobile/MobileFilterSheet.tsx` — dismissible account/lane filter sheet

### Snooze, undo, hotkeys
- `SnoozePicker.tsx` — floating date/time picker anchored to the snooze button
- `InboxUndoToast.tsx` — bottom-center undo toast
- `inboxHotkeys.ts` — key → action resolution per workflow (snapshot vs live)
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
- `src/components/alfred/` — Alfred Panel; receives the inbox ⌘Enter / Sparkles handoff
- `reader/` — detail-pane sub-area (see its map)
