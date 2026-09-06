# Inbox Map

The email triage and reading surface, desktop and mobile: active snapshots (triage windows), an initial-load live fallback, indexed search, snooze/undo, and the reader pane. Entry points are `InboxView.tsx` (orchestrator) and `useInboxController.ts` (central state machine); `reader/Reader.tsx` routes the detail pane. On desktop, AI questions about mail hand off to Alfred (⌘Enter / Sparkles open the Alfred Panel with the query — in-layout Alfred conversation alongside the reader or list). Mobile exposes no Alfred entry point.

## Sub-maps

- `reader/` — desktop/mobile detail pane, bodies, triage, bill and transaction-import actions (see `reader/CLAUDE.md`)

## Files

- `useSnoozedEmails.ts` / `inboxSnoozedModel.ts` — deferred collection fetch/return reconciliation and canonical row projection, independent of snapshot history.

### Views + orchestration
- `InboxView.tsx` — composes active/historical snapshot modes and the initial-load live fallback, session state, undo coordination
- `InboxDesktopPane.tsx` — desktop layout: digest, sidebar, list, reader, undo toast; reserves Alfred’s dock and preserves hidden navigation/list state during narrow-desktop discussions
- `InboxDesktopHeader.tsx` — list-aligned search, history and processing context
- `InboxDesktop.css` — scoped desktop queue/rail hierarchy, responsive sizing and interaction states
- `inboxViewTypes.ts` — shared top-level desktop/mobile pane composition contract
- `useInboxController.ts` — central state machine: selection, filters, search, undo, desktop Alfred handoff
- `inboxReadRoutingModel.ts` — read-scope routing (`resolveReadScope`) + `planMarkAllVisibleRead`; one home for the live/snapshot/indexed decision shared by mark-all and auto-mark-read
- `useInboxActionDispatch.ts` — action handlers: trash, snooze, lane move, mark read, draft reply
- `useInboxSessionState.ts` — external session store surviving unmount/tab switches
- `useSnapshotOptimisticOverlay.ts` — reconciles optimistic overlays against snapshot refreshes
- `useInboxUndoSlot.ts` — undo slot lifecycle: timer, pending, commit/settle

### List + rows
- `InboxList.tsx` — bounded desktop list, lane headings, read controls, skeletons and search results
- `InboxLaneFilterBar.tsx` — All mail and primary lanes; populated Queued, Catch-up and Untriaged Read views below a divider
- `LaneSection.tsx` — memoized swimlane lane section: sticky header + collapsible row body
- `EmailRow.tsx` — sender/subject/preview row, optional concise action hint and carryover provenance
- `InboxRowTransition.tsx` — desktop/mobile row and desktop lane motion shell; source and destination space animate together; departing content is immediately inert
- `DigestStrip.tsx` — header strip: snapshot status, lane counts, processing activity
- `DesktopSnapshotNavigator.tsx` — compact header history group with adjacent navigation, snapshot context, and direct return to current
- `SnapshotNavigationControls.tsx` — shared desktop/mobile adjacent-snapshot controls with boundary, loading, and error states
- `Sidebar.tsx` — account scope, fixed desktop lane navigation, secondary views and compact shortcuts
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
- `mobile/MobileInboxView.tsx` — mobile layout: compact toolbar with expandable search and local unread toggle, chronological rows, filters, reader
- `mobile/MobileSnapshotHeader.tsx` — persistent historical context and direct return to Current
- `mobile/MobileFilterSheet.tsx` — dismissible account/lane filters, adjacent snapshot navigation, and scoped mark-all-read action
- `mobile/MobileEmailRow.tsx` — readable mobile message row with full-width subject, unread dot, and separate status line
- `mobile/MobileInbox.css` — mobile list, controls, and filter-sheet layout and interaction states

### Snooze, undo, hotkeys
- `SnoozePicker.tsx` / `SnoozePicker.css` — content-sized floating date/time picker anchored to the snooze button; mobile uses a content-sized sheet
- `InboxUndoToast.tsx` — bottom-center undo toast
- `inboxHotkeys.ts` — key → action resolution per workflow (snapshot vs live fallback)
- `useInboxKeyboardCommands.ts` — window hotkeys: undo, search focus, j/k nav, actions

### Shared
- `InboxEmptyState.tsx` / `InboxEmptyState.css` — restrained list/reader empty presentations and recovery controls
- `helpers.ts` — time formatters, snooze presets and optional action-hint text filtering
- `primitives.tsx` — LaneIcon, NumberField and QuickAction
- `test-utils/inboxFixtures.ts` — email/account test factories
- `test-utils/mobileInboxActions.test-utils.ts` — shared mobile action-sheet and search drivers for existing Inbox behavior tests

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Optimistic UI: snapshot mutations apply overlays immediately and reconcile on refresh.
- Session state lives outside React (external store) so tab switches don't reset triage position.
- Lane-based classification drives filtering and hotkeys; `activeSnapshotWorkflowModel.ts` owns lane rules and reading order. Carryover is provenance (`_carryover`), shown inside the assigned Needs Attention/Queued lane. Existing Untriaged Read rows remain visible regardless of the current triage-read setting.

## Related

- `server/routes/briefing/` — email/snapshot endpoints this UI calls
- `src/lib/triageSoundGate.ts` — sound dedup gate for triage events
- `src/components/alfred/` — desktop-only Alfred Panel; receives the desktop inbox ⌘Enter / Sparkles handoff
- `reader/` — detail-pane sub-area (see its map)
