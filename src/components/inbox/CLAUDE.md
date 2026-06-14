# Inbox Map

The email triage and reading surface, desktop and mobile: live-polled email, active snapshots (triage windows), indexed search, snooze/undo, and the reader pane. Entry points are `InboxView.jsx` (orchestrator) and `useInboxController.js` (central state machine); `reader/Reader.jsx` routes the detail pane. AI questions about mail hand off to Alfred (⌘Enter / Sparkles open the Alfred Panel with the query — no in-inbox AI answer surface).

## Files

### Views + orchestration
- `InboxView.jsx` — composes live/snapshot modes, session state, undo coordination
- `InboxDesktopPane.jsx` — desktop layout: digest, sidebar, list, reader, undo toast
- `useInboxController.js` — central state machine: selection, filters, search, undo, Alfred handoff
- `useInboxActionDispatch.js` — action handlers: trash, snooze, lane move, mark read, draft reply
- `useInboxSessionState.js` — external session store surviving unmount/tab switches
- `useSnapshotOptimisticOverlay.js` — reconciles optimistic overlays against snapshot refreshes
- `useInboxUndoSlot.js` — undo slot lifecycle: timer, pending, commit/settle

### List + rows
- `InboxList.jsx` — list container: skeletons, search, filter chips, Alfred handoff (⌘Enter)
- `LaneSection.jsx` — memoized swimlane lane section: sticky header + collapsible row body
- `EmailRow.jsx` — single email row: avatar, preview, urgency/lane bar
- `DigestStrip.jsx` — header strip: live/snapshot status, lane counts, processing activity
- `Sidebar.jsx` — account and lane navigation
- `inboxRow.js` — canonical row normalization: field fallbacks, read-override merge
- `inboxWorkItems.js` — work item pipelines: active-snapshot, live, resurfaced-snooze
- `inboxCountsModel.js` — scoped unread counts under account/category filters
- `inboxNowTick.js` — schedules the `nowTick` timeout to the soonest snooze boundary or grace-label transition
- `inboxProcessingModel.js` — triage activity counts from processing state
- `snapshotSummary.js` — lane breakdown text for the digest header
- `activeSnapshotWorkflowModel.js` — lane routing, mutable/dismissible rules, reopen logic
- `inboxCommandModel.js` — builds trash/lane-move commands per email scope

### Filters + search
- `InboxCategoryFilterChips.jsx` — category chip menu with overflow dropdown
- `InboxCategoryFilterChipsModel.js` — category ordering: critical > commitment > passive
- `InboxSearchFlagChips.jsx` — is:unread toggle chip
- `InboxSearchFlagChipsModel.js` — parses/toggles is:read|is:unread flags in queries
- `indexedSearchModel.js` — normalizes indexed search results, merges read state

### Reader
- `reader/Reader.jsx` — detail-pane router (desktop/mobile), body loading, snooze/bill state
- `reader/DesktopReader.jsx` — desktop detail layout with triage panel
- `reader/EmailBodyPane.jsx` — iframe HTML/plain-text body renderer
- `reader/TriagePanel.jsx` — AI summary, bullets, urgency, lane tag display
- `reader/DraftReply.jsx` — AI-drafted reply with send/discard
- `reader/ReaderShared.jsx` — section accordion and empty-state primitives
- `reader/useEmailBody.js` — fetches and caches body HTML, preview fallback
- `reader/useBillPayResolver.js` — resolves bill extraction for the open email
- `reader/billExtractionBody.js` — body state for the bill-pay workflow
- `reader/MobileReader.jsx` — mobile detail pane with action row
- `reader/MobileActionRow.jsx` — single-row mobile action buttons
- `reader/MobileReaderControls.jsx` — pill badges and inline mobile controls

### Mobile
- `mobile/MobileInboxView.jsx` — mobile layout: chip filter bar, compact rows, reader
- `mobile/MobileFilterSheet.jsx` — dismissible account/lane filter sheet

### Snooze, undo, hotkeys
- `SnoozePicker.jsx` — floating date/time picker anchored to the snooze button
- `InboxUndoToast.jsx` — bottom-center undo toast
- `inboxHotkeys.js` — key → action resolution per workflow (snapshot vs live)
- `useInboxKeyboardCommands.js` — window hotkeys: undo, search focus, j/k nav, actions

### Shared
- `helpers.js` — time formatters and snooze preset builder
- `primitives.jsx` — Kbd, Avatar, Eyebrow, StickyHeader, LaneIcon, QuickAction
- `test-utils/inboxFixtures.js` — email/account test factories

(Tests are not listed: `X.test.js(x)` covers `X` by convention. `test-utils/*` ARE listed — shared infra.)

## Local patterns

- Optimistic UI: snapshot mutations apply overlays immediately and reconcile on refresh.
- Session state lives outside React (external store) so tab switches don't reset triage position.
- Lane-based classification drives both filtering and hotkey behavior; lane rules live in `activeSnapshotWorkflowModel.js`.

## Related

- `server/routes/briefing/` — email/snapshot endpoints this UI calls
- `src/lib/triageSoundGate.js` — sound dedup gate for triage events
- `src/components/alfred/` — Alfred Panel; receives the inbox ⌘Enter / Sparkles handoff
