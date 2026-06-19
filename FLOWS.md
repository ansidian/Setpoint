# Flows

Cross-layer pipelines and cross-cutting behaviors that no single file owns. Each flow:
trigger → numbered hops (`file:function`) → caches touched → SSE events → UI landing point.
When a fix touches a flow, walk every hop — partial fixes here are the known failure mode.

## 1. Bill pay → Actual sync → metadata invalidation

**Trigger:** user sends a bill from the bill badge form (`src/components/bills/useBillBadgeForm.js:handleSend`) → POST `/api/briefing/actual/send` handled in `server/routes/briefing/bills.js`.

1. `server/bills/bills-service.js:sendBill` — runs the write, then the invalidation fan-out and mirror refresh scheduling
2. `server/actual/actual.js:sendBill` — 3-way write branch: lightweight CRDT → SDK worker fallback → in-process SDK
3. `server/actual/actual-lightweight-writes.js:sendBillLightweight` — serializes behind the lightweight write lock; sync-push failure is tagged `ACTUAL_LIGHTWEIGHT_SYNC_FAILED` with `localWriteApplied` (never retried)
4. `server/actual/actual-worker.js:runActualWorkerOperation` — fallback only on `ACTUAL_LIGHTWEIGHT_UNSUPPORTED`: SDK write in a forked worker (`server/actual/actual-core.js:sendBill`)
5. `server/actual/actual.js:clearMetadataCache` — clears the facade's 5-min TTL cache (level b) immediately after the write
6. `server/bills/bills-service.js:invalidateActualMetadata` — authoritative fan-out (run in background): clears level b, re-syncs level d, rewrites level c
7. `server/actual/actual-local-metadata.js:readLocalActualMetadata` — re-syncs the on-disk budget copy (level d) from the Actual server
8. `server/actual/actual-metadata-projection.js:refreshActualMetadataProjection` — rewrites the `ea_actual_metadata_mirror` DB projection (level c)
9. `server/bills/bills-mirror-sync.js:scheduleBillsMirrorRefresh` — writes `pending_refresh_at` (+60s) and arms the in-process timer; `runDueBillsMirrorRefresh` later rewrites the bill schedule/occurrence mirrors
10. `server/dashboard/current-providers/bills-provider.js:onRefreshed` — when the visible bills projection changed, publishes a `source: "bills"` dashboard event
11. `server/dashboard/current-events.js:publishCurrentDashboardEvent` — fans the event out to per-user SSE listeners
12. `src/hooks/useCurrentDashboard.js:handleChanged` — on `source === "bills"`: invalidates the frontend metadata singleton, then refetches the dashboard payload
13. `src/lib/actualMetadata.js:invalidateActualMetadata` — nulls the singleton cache (level a) and bumps the generation counter so stale in-flight fetches can't repopulate it
14. `src/lib/actualMetadata.js:ensureMetadataLoaded` — next consumer refetches GET `/api/briefing/actual/metadata`, served from level c

**Caches (the 4 levels, outermost first; layering diagram lives at the top of `server/bills/bills-service.js`):**
- (a) frontend metadata singleton — `src/lib/actualMetadata.js` — invalidated by the bills SSE event, generation-guarded
- (b) in-process 5-min TTL caches — `server/actual/actual.js` facade + `server/actual/actual-core.js` worker side — cleared on every write and by the fan-out
- (c) `ea_actual_metadata_mirror` DB projection — `server/actual/actual-metadata-projection.js` — rewritten during the fan-out and by bills mirror refreshes
- (d) on-disk local budget copy — `server/actual/actual-local-metadata.js` — re-synced from the Actual server when the fan-out runs with fresh-local preference

**SSE:** `dashboard-current-changed` with `source: "bills"` — emitted via `server/dashboard/current-events.js:publishCurrentDashboardEvent`, streamed by the GET `/current/events` handler in `server/routes/dashboard.js` — consumed by `src/hooks/useCurrentDashboard.js:handleChanged`.

**UI:** dashboard bills rail (`src/components/dashboard/rails/BillsRail.jsx`), calendar bills view (`src/components/calendar/views/bills/BillsDetailRail.jsx`), and bill badge form dropdowns on next metadata load.

## 2. Email sync → inbox triage

**Trigger:** Gmail Pub/Sub push (POST `/api/gmail/push` → `server/routes/gmail-push.js`) enqueues a history sync via `server/email/gmail-sync.js:enqueueHistorySyncFromPubSub`; the per-minute cron `server/scheduler.js:runGmailHistorySyncWorker` is the poll fallback that drains the queue.

1. `server/email/gmail-sync.js:processNextGmailHistorySyncJob` — claims a queued job, loads the account
2. `server/email/gmail-sync.js:syncGmailHistoryForAccount` — pages Gmail history, fetches new messages, reconciles read/removal state
3. `server/email/email-index.js:indexEmails` — parses and writes emails into `ea_email_index`
4. `server/email/gmail-sync.js:triageStatementsForEmail` — inserts a pending `ea_email_triage` row and an arrival-grace-scheduled triage job
5. `server/snapshots/snapshot-triage-attachment.js:attachArrivalGraceEmailToActiveSnapshot` — upserts a queued-lane snapshot item, publishes `email_triage_queued`
6. `server/scheduler.js:runEmailTriageWorker` — per-minute cron drains triage jobs (also drained inline by `server/snapshots/snapshot-service.js:syncActiveSnapshot`)
7. `server/triage/triage-worker.js:processNextEmailTriageJob` — claims the job, handles skip/defer/grace branches
8. `server/triage/triage-worker.js:routeEmailForTriage` — preflight rules, then cheap-model classification with strong-model escalation
9. `server/triage/triage-worker.js:updateTriageRow` — persists the decision (lane, summary, bill candidate) to `ea_email_triage`
10. `server/triage/triage-worker.js:attachToActiveSnapshot` — upserts `ea_briefing_snapshot_items` with the decided lane
11. `server/dashboard/current-events.js:publishCurrentDashboardEvent` — fans `email_triage_finalized`/`email_triage_failed` to SSE subscribers
12. `src/hooks/useCurrentDashboard.js:handleChanged` — forwards the payload to the dashboard event handler and refetches
13. `src/components/inbox/inboxWorkItems.js:collectActiveSnapshotEmails` — flattens snapshot lanes into normalized inbox rows
14. `src/hooks/useTriageNotificationSounds.js:handleDashboardEvent` — resolves the sound for the trigger type
15. `src/lib/triageSoundGate.js:createTriageSoundGate` — gate's accept() dedupes by eventKey and coalesces per trigger (4s window)

**Caches:** `ea_gmail_watch_state` history cursor (`server/email/gmail-sync.js`, reset on 404 recovery); `ea_email_index` (`server/email/email-index.js`); `ea_triage_jobs` queue + `ea_email_triage` decisions (written by the sync, settled by the worker); `ea_briefing_snapshot_items` (upserted at queue-attach and finalize); sessionStorage `ea_triage_sound_event_keys` (`src/lib/triageSoundGate.js`, capped 200).

**SSE:** `dashboard-current-changed` (reasons `email_triage_queued`/`email_triage_finalized`/`email_triage_failed`) — emitted by `server/dashboard/current-events.js:publishCurrentDashboardEvent`, streamed by GET `/current/events` in `server/routes/dashboard.js` — consumed by `src/hooks/useCurrentDashboard.js:handleChanged`, routed to `src/hooks/useTriageNotificationSounds.js` via `src/pages/Dashboard.jsx`.

**UI:** inbox lanes (`src/components/inbox/InboxView.jsx` → `src/components/inbox/InboxDesktopPane.jsx` / `src/components/inbox/mobile/MobileInboxView.jsx`): email appears in Queued during arrival grace, moves to its decided lane after classification; lane counts in `src/components/inbox/DigestStrip.jsx`; one gated notification sound per eventKey.

## 3. Snapshot / briefing lifecycle

**Trigger:** cron boundary advance — `server/scheduler.js:initScheduler` (per-user schedule) calls `server/snapshots/snapshot-service.js:advanceSnapshotBoundary`; snapshots are also created lazily on any read via `server/snapshots/snapshot-service.js:getOrCreateActiveSnapshot`.

1. `server/snapshots/snapshot-service.js:advanceSnapshotBoundary` — freezes active snapshots at the boundary (active → frozen), inserts the new active row
2. `server/snapshots/snapshot-service.js:copyCarryoverItems` — copies unresolved needs_attention/queued items into the new snapshot
3. `server/snapshots/snapshot-triage-attachment.js:attachArrivalGraceEmailToActiveSnapshot` — new email lands in the queued lane (see flow 2)
4. `server/triage/triage-worker.js:attachToActiveSnapshot` — triage decisions land in their lanes (see flow 2)
5. `server/snapshots/snapshot-snooze-lifecycle.js:deferPendingTriageForSnooze` — snoozing hides the item and reschedules its triage job to wake time
6. `server/snapshots/snooze-waker.js:wakeDueSnoozes` — 5-min cron flips snoozed → resurfaced, re-attaches to the active snapshot
7. `server/snapshots/snapshot-snooze-lifecycle.js:attachResurfacedSnoozeToActiveSnapshot` — upserts the resurfaced item, lane normalized by `server/snapshots/snapshot-state-machine.js:resurfacedTriageLane`
8. `server/snapshots/snapshot-item-mutations.js:moveSnapshotItemLane` — user lane transitions (plus handled/reopen mutations) via the snapshot item routes
9. `server/snapshots/snapshot-service.js:getActiveSnapshotView` — loads items, derives lanes and read-only state (frozen snapshots are read-only)
10. `server/snapshots/snapshot-lifecycle.js:normalizeSnapshotItem` — normalizes DB rows: lane, catch-up id, resurfaced flags, bill candidate
11. `server/dashboard/current-events.js:publishCurrentDashboardEvent` — lifecycle changes publish dashboard events
12. `src/hooks/useCurrentDashboard.js:handleChanged` — SSE-triggered refetch embeds the fresh snapshot view in the dashboard payload
13. `src/hooks/useActiveSnapshot.js:useActiveSnapshot` — standalone fallback fetch; 15s poll while processing is active
14. `src/components/inbox/InboxView.jsx:InboxView` — renders snapshot lanes; read-only when frozen

**Caches:** single-flight sync map in `server/snapshots/snapshot-service.js` (dedupes concurrent active-snapshot syncs); `ea_current_data_cache` rows in `server/dashboard/current-service.js` (other providers; the active snapshot itself is fetched fresh); frontend snapshot state in `src/hooks/useActiveSnapshot.js` and `src/hooks/useCurrentDashboard.js`, overwritten on each refetch.

**SSE:** `dashboard-current-changed` (reasons incl. `email_triage_queued`, `email_triage_finalized`, `snoozed_pending_deferred`) — same emitter/stream/consumer chain as flow 2. Supplemented by polling: `src/hooks/useActiveSnapshot.js` every 15s while processing, `src/hooks/useCurrentDashboard.js` short post-refresh polling.

**UI:** inbox lane lists and counts (`src/components/inbox/InboxList.jsx`, `src/components/inbox/DigestStrip.jsx`, `src/components/inbox/Sidebar.jsx`); frozen snapshots render read-only — lane/hotkey rules mirrored in `src/components/inbox/activeSnapshotWorkflowModel.js`.

## 4. Calendar range planning → search mirror → modal controller

**Trigger:** modal open / month paging — `src/hooks/calendar/usePlanningReadinessState.js:usePlanningReadinessState` computes the visible grid range and calls ensureRange; search keystrokes enter at hop 6.

1. `src/hooks/calendar/useCalendarRange.js:ensureRange` — finds missing/in-flight month keys, awaits foreground groups, kicks stale refresh + prefetch
2. `src/hooks/calendar/calendarRangeModel.js:groupMonthKeys` — pure month-key math: dedupe, contiguous groups capped at 2 months per fetch
3. `src/hooks/calendar/useCalendarRange.js:fetchMonthGroup` — converts a group to bounds via `monthBounds`, fetches, buckets events per month into the cache
4. `src/api.js:getCalendarRange` — GET `/api/calendar/range`
5. `server/routes/calendar.js:validateCalendarRange` — validates ISO dates and ≤62-day span; handler fetches live from Google and hydrates reminder state
6. `src/hooks/calendar/useCalendarModalSearch.js:useCalendarModalSearch` — debounced (250ms) per-scope search with request-sequence guards
7. `src/api.js:getCalendarSearch` — GET `/api/calendar/search`
8. `server/routes/calendar.js:calendarSearchResponse` — merges mirror events + deadline candidates, builds coverage sources; stale/dirty mirror health triggers `requestCalendarSearchMirrorRepair` fire-and-forget
9. `server/calendar/calendar-search-mirror.js:listCalendarSearchMirrorOccurrences` — SQL LIKE over `ea_calendar_search_occurrences`, ordered by distance from today
10. `server/calendar/calendar-search.js:rankCalendarSearchCandidates` — ranks/truncates combined candidates to the client limit
11. `src/hooks/calendar/useCalendarModalController.jsx:activateCalendarSearchResult` — on activation: blocks if editor dirty, switches view, sets selection + pending detail focus
12. `src/hooks/calendar/useCalendarModalController.jsx:useCalendarModalController` — builds viewData.events (prev/current/next month) and the search shell, hands both to shell props

**Caches:** per-month events cache in `src/hooks/calendar/useCalendarRange.js` (30-min TTL, ±3-month prefetch radius; invalidated by explicit sync, patched by editor saves); per-scope search snapshots in `src/hooks/calendar/useCalendarModalSearch.js` (reset on query change/modal close); server mirror `ea_calendar_search_occurrences` owned by `server/calendar/calendar-search-mirror.js` (`syncCalendarSearchMirror` full/incremental + 15-min backstop worker; write-through upserts on single-event mutations in `server/routes/calendar.js`, recurring edits mark dirty for async repair).

**SSE:** `dashboard-current-changed` marks bill/deadline range caches stale (via `src/pages/Dashboard.refreshModel.js`) but does NOT touch the events month cache or the search mirror — those refresh via their own timers and explicit sync.

**UI:** month grid + agenda render through `src/components/calendar/modal/CalendarModalShell.jsx`; search results in `src/components/calendar/modal/CalendarSearchRail.jsx`; activating a result repositions the grid, selects the day/item, and opens the floating detail.

## 5. Calendar modifier-key selection gesture

**Trigger:** cmd/ctrl-click on any calendar event surface in the events view toggles the multi-selection set; bare cmd/ctrl while the floating detail is open promotes the focused event into the set or dismisses the panel.

Surface handlers — ALL of them forward modifier-clicks unconditionally (each duplicates a local `isEventSelectionModifier`); a fix to this gesture must touch every one:

1. `src/components/calendar/modal/CalendarCellItemChip.jsx:ItemChip` — month-grid chip (also rendered as inline-overflow item)
2. `src/components/calendar/modal/CalendarEventSpanOverlay.jsx:CalendarEventSpanOverlay` — multi-day/all-day span segments incl. birthday spans
3. `src/components/calendar/modal/CalendarCellOverflowPopover.jsx:CalendarCellOverflowPopover` — "+N more" overflow popover rows
4. `src/components/calendar/modal/CalendarInlineOverflowLayer.jsx:CalendarInlineOverflowLayer` — inline expanded overflow rows
5. `src/components/calendar/views/events/EventsAgendaEventRows.jsx:AllDayChip` — agenda rail all-day chip incl. birthdays
6. `src/components/calendar/views/events/EventsAgendaEventRows.jsx:TimedRow` — agenda rail timed row

(Deliberate non-surfaces: `src/components/calendar/modal/CalendarCell.jsx` day-cell/date-header clicks ignore modifiers so cells don't steal the gesture; the search rail `src/components/calendar/modal/CalendarSearchRail.jsx` forwards nothing — the historical "missed surface" risk.)

Selection path:

7. `src/hooks/calendar/useCalendarModalController.jsx:toggleCalendarEventSelectionSet` — events-view guard; identity-less special dates (birthdays) are dismiss-only; a dirty floating editor shakes instead of toggling; closes editor/detail, seeds the set with the prior selection
8. `src/components/calendar/events/calendarEventSelectionModel.js:toggleCalendarEventSelection` — immutable toggle keyed by `calendarEventSelectionIdentity` (account::calendar::series::occurrence)
9. `src/hooks/calendar/useCalendarModalHotkeys.js:handleKey` — bare Meta/Control with a detail-mode panel open calls the begin-selection callback, falling through to dismissal for ineligible items
10. `src/hooks/calendar/useCalendarModalController.jsx:addSelectedCalendarEventToSelectionSet` — returns false for identity-less events so the hotkey dismisses the panel instead
11. `src/components/calendar/modal/CalendarCellOverflowPopover.jsx` — the overflow popover's own pointerdown handler carves out grid cells, rails, and floating-detail targets so it stays open during multi-select (the calendar is a shell tab now; there is no surface-level outside-dismiss)
12. `src/components/calendar/modal/CalendarGrid.jsx:handleSelectDay` — plain clicks clear the selection set unless the anchor preserves it (`handleSelectItem` likewise)
13. `src/hooks/calendar/useCalendarModalController.jsx:requestSelectedCalendarEventDelete` — Delete/Backspace batch-deletes the set; cmd+C copies via `copySelectedCalendarEvent`

**State:** the multi-selection set lives only in `src/hooks/calendar/useCalendarModalController.jsx` (React state + ref mirror), shaped by `src/components/calendar/events/calendarEventSelectionModel.js`; client-only, never persisted. The single day/item focus is separate, owned by `src/hooks/calendar/useCalendarModalSelection.js` + `src/hooks/calendar/calendarModalSelectionModel.js`.

**SSE:** none — purely client-side state.

**UI:** selected chips get the selection accent border/wash on every surface; first modifier-click closes any open detail/editor; bare cmd/ctrl promotes-or-dismisses; plain click anywhere clears the set.
