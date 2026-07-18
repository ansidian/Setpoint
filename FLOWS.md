# Flows

Cross-layer pipelines and cross-cutting behaviors that no single file owns. Each flow:
trigger → numbered hops (`file:function`) → caches touched → SSE events → UI landing point.
When a fix touches a flow, walk every hop — partial fixes here are the known failure mode.

## 1. Bill pay → Actual sync → metadata invalidation

**Trigger:** user sends a bill from the bill badge form (`src/components/bills/useBillBadgeForm.ts:handleSend`) → POST `/api/briefing/actual/send` handled in `server/routes/briefing/bills.ts`.

1. `server/bills/bills-service.ts:sendBill` — runs the write, then the invalidation fan-out and mirror refresh scheduling
2. `server/actual/actual.ts:sendBill` — 3-way write branch: lightweight CRDT → SDK worker fallback → in-process SDK
3. `server/actual/actual-lightweight-writes.ts:sendBillLightweight` — serializes behind the lightweight write lock; sync-push failure is tagged `ACTUAL_LIGHTWEIGHT_SYNC_FAILED` with `localWriteApplied` (never retried)
4. `server/actual/actual-worker.ts:runActualWorkerOperation` — fallback only on `ACTUAL_LIGHTWEIGHT_UNSUPPORTED`: SDK write in a forked worker (`server/actual/actual-core.ts:sendBill`)
5. `server/actual/actual.ts:clearMetadataCache` — clears the facade's 5-min TTL cache (level b) immediately after the write
6. `server/bills/bills-service.ts:invalidateActualMetadata` — authoritative fan-out (run in background): clears level b, re-syncs level d, rewrites level c
7. `server/actual/actual-local-metadata.ts:readLocalActualMetadata` — re-syncs the on-disk budget copy (level d) from the Actual server
8. `server/actual/actual-metadata-projection.ts:refreshActualMetadataProjection` — rewrites the `ea_actual_metadata_mirror` DB projection (level c)
9. `server/bills/bills-mirror-sync.ts:scheduleBillsMirrorRefresh` — writes `pending_refresh_at` (+60s) and arms the in-process timer; `runDueBillsMirrorRefresh` later rewrites the bill schedule/occurrence mirrors
10. `server/dashboard/current-providers/bills-provider.ts:onRefreshed` — when the visible bills projection changed, publishes a `source: "bills"` dashboard event
11. `server/dashboard/current-events.ts:publishCurrentDashboardEvent` — fans the event out to per-user SSE listeners
12. `src/hooks/useCurrentDashboard.ts:handleChanged` — on `source === "bills"`: invalidates the frontend metadata singleton, then refetches the dashboard payload
13. `src/lib/actualMetadata.ts:invalidateActualMetadata` — nulls the singleton cache (level a) and bumps the generation counter so stale in-flight fetches can't repopulate it
14. `src/lib/actualMetadata.ts:ensureMetadataLoaded` — next consumer refetches GET `/api/briefing/actual/metadata`, served from level c

**Caches (the 4 levels, outermost first; layering diagram lives at the top of `server/bills/bills-service.ts`):**
- (a) frontend metadata singleton — `src/lib/actualMetadata.ts` — invalidated by the bills SSE event, generation-guarded
- (b) in-process 5-min TTL caches — `server/actual/actual.ts` facade + `server/actual/actual-core.ts` worker side — cleared on every write and by the fan-out
- (c) `ea_actual_metadata_mirror` DB projection — `server/actual/actual-metadata-projection.ts` — rewritten during the fan-out and by bills mirror refreshes
- (d) on-disk local budget copy — `server/actual/actual-local-metadata.ts` — re-synced from the Actual server when the fan-out runs with fresh-local preference

**SSE:** `dashboard-current-changed` with `source: "bills"` — emitted via `server/dashboard/current-events.ts:publishCurrentDashboardEvent`, streamed by the GET `/current/events` handler in `server/routes/dashboard.ts` — consumed by `src/hooks/useCurrentDashboard.ts:handleChanged`.

**UI:** dashboard Needs-you band + Coming-up card (`src/components/dashboard/needsYou/needsYouModel.ts` classifies due-today bills; `src/components/dashboard/context/ComingUpCard.tsx` lists upcoming ones), calendar bills view (`src/components/calendar/views/bills/BillsDetailRail.tsx`), and bill badge form dropdowns on next metadata load.

## 2. Email sync → inbox triage

**Trigger:** Gmail Pub/Sub push (POST `/api/gmail/push` → `server/routes/gmail-push.ts`) durably enqueues a history sync via `server/email/gmail-sync.ts:enqueueHistorySyncFromPubSub`, acknowledges the webhook, then requests an immediate coalesced drain via `server/scheduler.ts:requestGmailHistorySyncDrain`; the per-minute cron remains the reliability fallback.

1. `server/email/gmail-sync.ts:processNextGmailHistorySyncJob` — claims a queued job, loads the account
2. `server/email/gmail-sync.ts:syncGmailHistoryForAccount` — pages Gmail history, fetches new messages, reconciles read/removal state
3. `server/email/email-index.ts:indexEmails` — parses and writes emails into `ea_email_index`
4. `server/email/gmailTriageStatements.ts:triageStatementsForEmail` — inserts a pending `ea_email_triage` row and an arrival-grace-scheduled triage job
5. `server/snapshots/snapshot-triage-attachment.ts:attachArrivalGraceEmailToActiveSnapshot` — upserts a queued-lane snapshot item, publishes `email_triage_queued`
6. `server/scheduler.ts:requestEmailTriageDrainAt` / `runEmailTriageWorker` — successful arrival-grace writes arm one process-local timer for the earliest durable `scheduled_for`; a timer firing during an active drain queues one follow-up check, while the unchanged 30-second cron remains restart/missed-timer recovery (jobs are also drained inline by `server/snapshots/snapshot-service.ts:syncActiveSnapshot`)
7. `server/triage/triage-worker.ts:processNextEmailTriageJob` — claims the job, handles skip/defer/grace branches
8. `server/triage/triage-worker.ts:routeEmailForTriage` — preflight rules, then cheap-model classification with strong-model escalation
9. `server/triage/triage-finalize-store.ts:updateTriageRow` — persists the decision (lane, summary, bill candidate) to `ea_email_triage`
10. `server/triage/triage-finalize-store.ts:attachToActiveSnapshot` — upserts `ea_briefing_snapshot_items` with the decided lane
11. `server/dashboard/current-events.ts:publishCurrentDashboardEvent` — fans `email_triage_finalized`/`email_triage_failed` to SSE subscribers
12. `src/hooks/dashboardEventRefreshModel.ts:refreshScopeForDashboardEvent` / `src/hooks/useCurrentDashboard.ts:handleChanged` — forwards the payload to the dashboard event handler, routes `email_triage` to the existing active-snapshot read, and keeps every other or unknown source on the full-current read; queued bursts retain the strongest pending scope and snapshot-read failure falls back once to full current
13. `src/components/inbox/inboxWorkItems.ts:collectActiveSnapshotEmails` — flattens snapshot lanes into normalized inbox rows
14. `src/hooks/useTriageNotificationSounds.ts:handleDashboardEvent` — resolves the sound for the trigger type
15. `src/lib/triageSoundGate.ts:createTriageSoundGate` — gate's accept() dedupes by eventKey and coalesces per trigger (4s window)

**Caches:** `ea_gmail_watch_state` history cursor (`server/email/gmail-sync.ts`, reset on 404 recovery); `ea_email_index` (`server/email/email-index.ts`); `ea_triage_jobs` queue + `ea_email_triage` decisions (written by the sync, settled by the worker); `ea_briefing_snapshot_items` (upserted at queue-attach and finalize); sessionStorage `ea_triage_sound_event_keys` (`src/lib/triageSoundGate.ts`, capped 200).

**SSE:** `dashboard-current-changed` (reasons `email_triage_queued`/`email_triage_finalized`/`email_triage_failed`) — emitted by `server/dashboard/current-events.ts:publishCurrentDashboardEvent`, streamed by GET `/current/events` in `server/routes/dashboard.ts` — consumed by `src/hooks/useCurrentDashboard.ts:handleChanged`, routed to `src/hooks/useTriageNotificationSounds.ts` via `src/pages/Dashboard.tsx`.

**UI:** inbox lanes (`src/components/inbox/InboxView.tsx` → `src/components/inbox/InboxDesktopPane.tsx` / `src/components/inbox/mobile/MobileInboxView.tsx`): email appears in Queued during arrival grace, moves to its decided lane after classification; lane counts in `src/components/inbox/DigestStrip.tsx`; one gated notification sound per eventKey.

**Timing:** `server/email/email-arrival-timing.ts:projectEmailArrivalTiming` emits non-sensitive `[EA Timing]` evidence when a history job settles. `providerDeliveryMs` is Pub/Sub `publishTime` → durable history-job `created_at`; `historyQueueWaitMs` is durable enqueue → worker claim; `historySyncMs` is claim → completed Gmail fetch/index/snapshot attachment; `providerToQueuedMs` is Pub/Sub publish → durable triage rows ready for snapshot attachment; `snapshotAttachmentMs` is that durable milestone → history-job completion. Arrival-grace `scheduled_for` is the intentional classification boundary; the deadline wake-up removes cron-alignment jitter after that boundary without shortening grace. Missing/malformed timestamps omit dependent durations, and clock-skewed stages clamp to zero with validity metadata. `src/hooks/useCurrentDashboard.ts` separately measures `dashboard-event-refetch` from SSE receipt to accepted state dispatch with `performance.now()`, records the selected `active_snapshot` or `current` scope (including fallback scope), and does not log stale superseded responses as completed.

## 3. Snapshot / briefing lifecycle

**Trigger:** cron boundary advance — `server/scheduler.ts:initScheduler` (per-user schedule) calls `server/snapshots/snapshot-service.ts:advanceSnapshotBoundary`; snapshots are also created lazily on any read via `server/snapshots/snapshot-service.ts:getOrCreateActiveSnapshot`.

1. `server/snapshots/snapshot-service.ts:advanceSnapshotBoundary` — freezes active snapshots at the boundary (active → frozen), inserts the new active row
2. `server/snapshots/snapshot-service.ts:copyCarryoverItems` — copies unresolved needs_attention/queued items into the new snapshot
3. `server/snapshots/snapshot-triage-attachment.ts:attachArrivalGraceEmailToActiveSnapshot` — new email lands in the queued lane (see flow 2)
4. `server/triage/triage-finalize-store.ts:attachToActiveSnapshot` — triage decisions land in their lanes (see flow 2)
5. `server/snapshots/snapshot-snooze-lifecycle.ts:deferPendingTriageForSnooze` — snoozing hides the item and reschedules its triage job to wake time
6. `server/snapshots/snooze-waker.ts:wakeDueSnoozes` — 5-min cron flips snoozed → resurfaced, re-attaches to the active snapshot
7. `server/snapshots/snapshot-snooze-lifecycle.ts:attachResurfacedSnoozeToActiveSnapshot` — upserts the resurfaced item, lane normalized by `server/snapshots/snapshot-state-machine.ts:resurfacedTriageLane`
8. `server/snapshots/snapshot-item-mutations.ts:moveSnapshotItemLane` — user lane transitions (plus handled/reopen mutations) via the snapshot item routes
9. `server/snapshots/snapshot-service.ts:getActiveSnapshotView` — loads items, derives lanes and read-only state (frozen snapshots are read-only)
10. `server/snapshots/snapshot-lifecycle.ts:normalizeSnapshotItem` — normalizes DB rows: lane, catch-up id, resurfaced flags, bill candidate
11. `server/dashboard/current-events.ts:publishCurrentDashboardEvent` — lifecycle changes publish dashboard events
12. `src/hooks/useCurrentDashboard.ts:handleChanged` — SSE-triggered refetch embeds the fresh snapshot view in the dashboard payload
13. `src/hooks/useActiveSnapshot.ts:useActiveSnapshot` — standalone fallback fetch; 15s poll while processing is active
14. `src/components/inbox/InboxView.tsx:InboxView` — renders snapshot lanes; read-only when frozen

**Caches:** single-flight sync map in `server/snapshots/snapshot-service.ts` (dedupes concurrent active-snapshot syncs); `ea_current_data_cache` rows in `server/dashboard/current-service.ts` (other providers; the active snapshot itself is fetched fresh); frontend snapshot state in `src/hooks/useActiveSnapshot.ts` and `src/hooks/useCurrentDashboard.ts`, overwritten on each refetch.

**SSE:** `dashboard-current-changed` (reasons incl. `email_triage_queued`, `email_triage_finalized`, `snoozed_pending_deferred`) — same emitter/stream/consumer chain as flow 2. Supplemented by polling: `src/hooks/useActiveSnapshot.ts` every 15s while processing, `src/hooks/useCurrentDashboard.ts` short post-refresh polling.

**UI:** inbox lane lists and counts (`src/components/inbox/InboxList.tsx`, `src/components/inbox/DigestStrip.tsx`, `src/components/inbox/Sidebar.tsx`); frozen snapshots render read-only — lane/hotkey rules mirrored in `src/components/inbox/activeSnapshotWorkflowModel.ts`.

## 4. Calendar range planning → search mirror → modal controller

**Trigger:** modal open / month paging — `src/hooks/calendar/usePlanningReadinessState.ts:usePlanningReadinessState` computes the visible grid range and calls ensureRange; search keystrokes enter at hop 6.

1. `src/hooks/calendar/useCalendarRange.ts:ensureRange` — finds missing/in-flight month keys, awaits foreground groups, kicks stale refresh + prefetch
2. `src/hooks/calendar/calendarRangeModel.ts:groupMonthKeys` — pure month-key math: dedupe, contiguous groups capped at 2 months per fetch
3. `src/hooks/calendar/useCalendarRange.ts:fetchMonthGroup` — converts a group to bounds via `monthBounds`, fetches, buckets events per month into the cache
4. `src/api.ts:getCalendarRange` — GET `/api/calendar/range`
5. `server/routes/calendar.ts:validateCalendarRange` — validates ISO dates and ≤62-day span; handler fetches live from Google and hydrates reminder state
6. `src/hooks/calendar/useCalendarModalSearch.ts:useCalendarModalSearch` — debounced (250ms) per-scope search with request-sequence guards
7. `src/api.ts:getCalendarSearch` — GET `/api/calendar/search`
8. `server/routes/calendar.ts:calendarSearchResponse` — merges mirror events + deadline candidates, builds coverage sources; stale/dirty mirror health triggers `requestCalendarSearchMirrorRepair` fire-and-forget
9. `server/calendar/calendar-search-mirror.ts:listCalendarSearchMirrorOccurrences` — SQL LIKE over `ea_calendar_search_occurrences`, ordered by distance from today
10. `server/calendar/calendar-search.ts:rankCalendarSearchCandidates` — ranks/truncates combined candidates to the client limit
11. `src/hooks/calendar/useCalendarSearchActivation.ts:activateCalendarSearchResult` — on activation: blocks if editor dirty, switches view, sets selection + pending detail focus
12. `src/hooks/calendar/useCalendarModalController.tsx:useCalendarModalController` — builds viewData.events (prev/current/next month) and the search shell, hands both to shell props

**Caches:** per-month events cache in `src/hooks/calendar/useCalendarRange.ts` (30-min TTL, ±3-month prefetch radius; invalidated by explicit sync, patched by editor saves); per-scope search snapshots in `src/hooks/calendar/useCalendarModalSearch.ts` (reset on query change/modal close); server mirror `ea_calendar_search_occurrences` owned by `server/calendar/calendar-search-mirror.ts` (`syncCalendarSearchMirror` full/incremental + 15-min backstop worker; write-through upserts on single-event mutations in `server/routes/calendar.ts`, recurring edits mark dirty for async repair).

**SSE:** `dashboard-current-changed` marks bill/deadline range caches stale (via `src/pages/Dashboard.refreshModel.ts`) but does NOT touch the events month cache or the search mirror — those refresh via their own timers and explicit sync.

**UI:** month grid + agenda render through `src/components/calendar/modal/CalendarModalShell.tsx`; search results in `src/components/calendar/modal/CalendarSearchRail.tsx`; activating a result repositions the grid, selects the day/item, and opens the floating detail.

## 5. Calendar modifier-key selection gesture

**Trigger:** cmd/ctrl-click on any calendar event surface in the events view toggles the multi-selection set; bare cmd/ctrl while the floating detail is open promotes the focused event into the set or dismisses the panel.

Surface handlers — ALL of them forward modifier-clicks unconditionally (each uses the shared `isEventSelectionModifier` predicate); a fix to this gesture must touch every surface:

1. `src/components/calendar/modal/CalendarCellItemChip.tsx:ItemChip` — month-grid chip (also rendered as inline-overflow item)
2. `src/components/calendar/modal/CalendarEventSpanOverlay.tsx:CalendarEventSpanOverlay` — multi-day/all-day span segments incl. birthday spans
3. `src/components/calendar/modal/CalendarCellOverflowPopover.tsx:CalendarCellOverflowPopover` — "+N more" overflow popover rows
4. `src/components/calendar/modal/CalendarInlineOverflowLayer.tsx:CalendarInlineOverflowLayer` — inline expanded overflow rows
5. `src/components/calendar/views/events/EventsAgendaEventRows.tsx:AllDayChip` — agenda rail all-day chip incl. birthdays
6. `src/components/calendar/views/events/EventsAgendaEventRows.tsx:TimedRow` — agenda rail timed row

(Deliberate non-surfaces: `src/components/calendar/modal/CalendarCell.tsx` day-cell/date-header clicks ignore modifiers so cells don't steal the gesture; the search rail `src/components/calendar/modal/CalendarSearchRail.tsx` forwards nothing — the historical "missed surface" risk.)

Selection path:

7. `src/hooks/calendar/useCalendarEventSelectionSet.ts:toggleCalendarEventSelectionSet` — events-view guard; identity-less special dates (birthdays) are dismiss-only; a dirty floating editor shakes instead of toggling; closes editor/detail, seeds the set with the prior selection
8. `src/components/calendar/events/calendarEventSelectionModel.ts:toggleCalendarEventSelection` — immutable toggle keyed by `calendarEventSelectionIdentity` (account::calendar::series::occurrence)
9. `src/hooks/calendar/useCalendarModalHotkeys.ts:handleKey` — bare Meta/Control with a detail-mode panel open calls the begin-selection callback, falling through to dismissal for ineligible items
10. `src/hooks/calendar/useCalendarEventSelectionSet.ts:addSelectedCalendarEventToSelectionSet` — returns false for identity-less events so the hotkey dismisses the panel instead

11. `src/components/calendar/modal/CalendarCellOverflowPopover.tsx` — the overflow popover's own pointerdown handler carves out grid cells, rails, and floating-detail targets so it stays open during multi-select (the calendar is a shell tab now; there is no surface-level outside-dismiss)
12. `src/components/calendar/modal/CalendarGrid.tsx:handleSelectDay` — plain clicks clear the selection set unless the anchor preserves it (`handleSelectItem` likewise)
13. `src/hooks/calendar/useCalendarEventSelectionSet.ts:requestSelectedCalendarEventDelete` — Delete/Backspace batch-deletes the set; cmd+C copies via `copySelectedCalendarEvent`

## 6. Process shutdown → scheduler drain

**Trigger:** SIGTERM/SIGINT enters `server/shutdown.ts:createGracefulShutdown` through `server/index.ts`.

1. `server/shutdown.ts:createGracefulShutdown` — starts the 15-second force-exit deadline, stops accepting HTTP work, then runs background stop functions in order
2. `server/scheduler.ts:stopScheduler` — synchronously closes cron, interval, startup-timeout, and queued-immediate admission sources; repeated calls share one promise
3. `server/scheduler-work-registry.ts:createSchedulerWorkRegistry` — awaits every scheduler-owned task already running, including scheduler initialization, index sweep, Gmail watch/history work, triage/prune work, embeddings, reminders, and snapshot-boundary callbacks
4. `server/shutdown.ts:createGracefulShutdown` — exits cleanly after all stop functions settle; a stuck task remains bounded by the existing force-exit timer

**Durability:** shutdown does not rewrite queue state. Forced exits continue to recover through the existing stale-lock and durable cron fallback paths.

**State:** the multi-selection set lives in `src/hooks/calendar/useCalendarEventSelectionSet.ts` (React state + ref mirror, hosted by the controller), shaped by `src/components/calendar/events/calendarEventSelectionModel.ts`; client-only, never persisted. The single day/item focus is separate, owned by `src/hooks/calendar/useCalendarModalSelection.ts` + `src/hooks/calendar/calendarModalSelectionModel.ts`.

**SSE:** none — purely client-side state.

**UI:** selected chips get the selection accent border/wash on every surface; first modifier-click closes any open detail/editor; bare cmd/ctrl promotes-or-dismisses; plain click anywhere clears the set.

## 7. First-run owner claim → authenticated runtime

**Trigger:** the SPA reads `GET /api/auth/setup/status` before normal session auth. A missing `ea_owner` singleton routes the browser to `/setup`.

1. `src/pages/OwnerSetup.tsx` — prefills the visible browser origin, requires explicit canonical-URL confirmation, confirms the password locally, and sends both to `POST /api/auth/setup/claim`.
2. `server/auth/owner-claim-service.ts:claimInitialOwner` — rate-limited route work generates a stable UUID and bcrypt hash.
3. `server/auth/owner-store.ts:claimOwner` — one write transaction uses `INSERT OR IGNORE` against singleton key `1` and persists the confirmed origin in separate `ea_instance_metadata`; the uniqueness invariant admits one concurrent claimant and all others receive the fixed conflict.
4. `server/auth/recovery-code-store.ts:replaceRecoveryCodes` — generates eight high-entropy offline recovery codes, persists only SHA-256 hashes, and returns plaintext only in the successful claim response.
5. `server/middleware/auth.ts:createSession` — persists only the hashed session token plus its recent-auth timestamp; the successful browser receives the raw token in an HttpOnly cookie.
6. `server/auth/owner-context.ts:activateOwner` — exposes the claimed ID to remaining single-owner runtime modules and notifies startup gating.
7. `server/auth/owner-runtime.ts:createOwnerRuntimeGate` — starts schedulers and provider workers once, only after a stored or newly claimed owner exists.

**Compatibility:** `server/auth/owner-bootstrap.ts:resolveOwnerBootstrap` runs after migrations and before listen. It imports an exact legacy `EA_USER_ID`/`EA_PASSWORD_HASH` pair into `ea_owner`, preserves the bcrypt hash and ID, and fails closed for partial or conflicting state.

**Canonical origin:** `server/platform/canonical-url.ts` imports compatible legacy WebAuthn/Google callback values only when they identify one origin. Persisted state then drives WebAuthn RP values and Google, Todoist, Gmail Pub/Sub, and webhook callback projections. Security Settings previews affected passkeys and callback registrations before a recent-auth-gated change; request headers never write canonical state.

**Pre-claim boundary:** `server/middleware/owner-gate.ts` returns a fixed setup-required response for non-setup APIs. `GET /healthz` remains successful and reports only readiness plus the non-secret claimed boolean. Demo mode resolves setup as already claimed and rejects claim mutations locally without a network call.

## 8. Owner sign-in, step-up, and offline recovery

**Normal mode:** `ea_owner.auth_mode = password_or_passkey`. A valid password issues a session directly. Passkey options may instead create a short-lived `ea_pending_auth` binding, and successful WebAuthn verification consumes its challenge before issuing the same session type. Registering a passkey does not change this mode.

**Strict mode:** the owner explicitly changes `auth_mode` to `password_plus_passkey` through a recent-auth-protected Security action. Password login then creates pending auth and WebAuthn completes the session. Mode, password, passkey, recovery-code, and powerful API-token mutations require `ea_sessions.authenticated_at` to be within ten minutes.

**Recovery:** `POST /api/auth/recovery` rate-limits and atomically consumes one unused recovery-code hash. Success replaces the password, returns mode to password-or-passkey, clears passkeys, pending auth, WebAuthn challenges, and prior sessions, issues a fresh session, and returns a newly generated recovery-code set exactly once.

## 9. Todoist personal token → optional OAuth and webhooks

**Default:** `PUT /api/ea/settings` stores a write-only personal API token in `ea_settings`, marks `todoist_connection_mode = personal_token`, and clears OAuth refresh metadata. Task reads and writes continue through the same mirrored Todoist domain and periodic sync backstop.

**Advanced OAuth:**

1. `PUT /api/instance-credentials/todoist-oauth/pending` stages a client ID/client secret pair in the typed instance-credential registry; active stored or env-backed credentials remain in use.
2. `GET /api/ea/accounts/todoist/auth` binds the owner, browser cookie hash, one-time state, and pending credential versions in `ea_todoist_oauth_states`, then returns Todoist's authorization URL.
3. `GET /api/ea/accounts/todoist/callback` consumes the state, verifies expiry and browser binding, resolves the exact credential versions, and exchanges the code server-side.
4. Only a successful exchange promotes the candidate app pair and stores encrypted access/refresh tokens with `todoist_connection_mode = oauth`; failed or stale callbacks leave the working connection unchanged.
5. `server/tasks/todoist-token.ts` resolves current app credentials for every refresh and persists rotated refresh tokens. `server/tasks/todoist-webhook.ts` resolves the current client secret for every HMAC verification, so stored replacements activate without restart.

**Compatibility:** `TODOIST_CLIENT_ID` and `TODOIST_CLIENT_SECRET` remain runtime fallbacks and can be migrated through the explicit authenticated action without returning their values. Legacy encrypted personal and OAuth token rows are assigned an explicit mode by migration 036.

**Presentation:** `GET /api/ea/accounts/todoist/status` returns only mode, source, health, and canonical callback/webhook URLs. Settings keeps the personal token primary and places app registration, env migration, OAuth, and webhook guidance in an advanced disclosure.
