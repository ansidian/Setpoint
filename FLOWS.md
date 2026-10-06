# Flows

Cross-layer pipelines and cross-cutting behaviors that no single file owns. Each flow:
trigger → numbered hops (`file:function`) → caches touched → SSE events → UI landing point.
When a fix touches a flow, walk every hop — partial fixes here are the known failure mode.

## 1. Actual budget → mirrors → read-only Finances

Setpoint never writes to Actual. Transaction import and bill updates are owned by a separate service outside this repository; Setpoint reads the synchronized budget only.

**Connection:** Settings → Connections → Actual Budget saves the server URL, server password, sync ID and an optional end-to-end **Encryption password** through `POST /api/briefing/actual/connection` in `server/routes/briefing/actual-connection.ts` (`POST /actual/test` checks a candidate without saving). `server/actual/actual-connection-test.ts` checks reachability and, when an encryption password is supplied, verifies it against the budget's key test (PBKDF2-SHA512 + AES-256-GCM, as Actual does). `server/actual/actual-connection-settings.ts` swaps in the verified candidate and stores the encryption password encrypted in `ea_settings.actual_budget_encryption_password_encrypted`; it unlocks the budget inside the SDK session and is never sent to the Actual server. `DELETE /actual/connection` removes the connection; `POST /actual/cache/hydrate` and `GET /actual/cache/status` rebuild and inspect the local budget copy.

1. `server/bills/bills-mirror-sync.ts:startBillsMirrorRefreshWorker` — started from `server/index.ts`; checks every minute and refreshes a configured budget after five minutes, or one minute after a failure. Shutdown stops admission and drains in-flight refreshes before the SDK worker stops.
2. `server/bills/bills-mirror-sync.ts:runDueBillsMirrorRefresh` → `refreshBillsMirror` — single-flight per owner and budget; an unconfigured budget clears the mirrors.
3. `server/actual/actual-metadata-projection.ts:loadActualMetadataForProjection` → `server/actual/actual.ts:syncActualMetadata` — maintenance prefers a fresh SDK sync; other reads use the local copy. The persistent worker (`actual-worker.ts` → `actual-worker-child.ts`) serializes SDK operations. `actual-core.ts` loads the budget with `downloadBudget(syncId, { password })`, replaces a stale local copy once when its key no longer matches, syncs, and returns metadata.
4. `server/bills/bills-mirror-sync.ts:refreshBillsMirrorInner` — rewrites `ea_actual_metadata_mirror`, `ea_bill_schedule_mirror` and `ea_bill_occurrence_mirror`, records sync health in `ea_bills_mirror_state`, and retains paid history.
5. `server/routes/briefing/finances.ts` → `server/finances/finance-workspace.ts:readFinanceWorkspace` — `GET /api/briefing/finances` composes the metadata projection, the schedule mirror and a bounded Journal read from the local copy (`server/actual/actual-journal-read.ts`). `GET /finances/journal` serves month ranges. Reads never sync or write; each unavailable part is reported in `issues`.
6. `src/lib/financesApi.ts` → `src/components/finances/FinancesWorkspace.tsx` — `/finances` (shell tab, shortcut 6) shows Payments, Journal and the monthly payment chart; reads refresh on focus and tab restoration.

**Display layout:** the Payments **Organize** editor saves ordered groups through `PUT /api/briefing/finances/payment-groups` (`server/finances/payment-groups.ts`), checking the displayed revision and budget. It changes only Setpoint's layout, never Actual. GETs derive unsaved starter groups without writing.

**Caches:** in-process 5-minute TTL metadata caches in `server/actual/actual.ts` and the worker; the `ea_actual_metadata_mirror` / `ea_bill_*_mirror` projections; the on-disk local budget copy (`server/actual/actual-local-metadata.ts` reads it without network access).

**SSE:** none. The dashboard has no finance provider; Finances refetches on focus and tab restoration.

## 2. Email sync → inbox triage

**Trigger:** With `GMAIL_PUBSUB_SUBSCRIPTION` set, `server/email/gmail-pull.ts` receives outbound StreamingPull notifications and admits them through the same durable history queue before acknowledging them. The Google SDK bounds outstanding deliveries, renews leases and reconnects transient streams; the worker retries terminal closes with capped backoff, rejects failed admissions for redelivery, and stops admission before scheduler shutdown. No Gmail callback URL or push token is required in this mode; Gmail watches and ten-minute inbox reconciliation remain enabled. Without a pull subscription, Gmail Pub/Sub push (POST `/api/gmail/push` → `server/routes/gmail-push.ts`) durably enqueues a history sync via `server/email/gmail-sync.ts:enqueueHistorySyncFromPubSub`, acknowledges the webhook, then requests an immediate coalesced drain via `server/scheduler.ts:requestGmailHistorySyncDrain`; the per-minute cron remains the reliability fallback.

0. `server/email/gmail-pubsub.ts:verifyToken` — performs one narrow shared-database hash/tombstone read for every delivery, hashes the candidate, and compares fixed-length hashes with `timingSafeEqual`; no TTL cache is used, so rotation/revocation is immediate across processes and restarts. Database failure returns a retryable `503` without queueing work or logging token material.
1. `server/email/gmail-sync.ts:processNextGmailHistorySyncJob` — claims a queued job, loads the account
2. `server/email/gmail-sync.ts:syncGmailHistoryForAccount` — pages Gmail history, fetches new messages, reconciles read/removal state
3. `server/email/gmail.ts` → `server/email/sender-authentication.ts:evaluateGmailSenderAuthentication` normalizes the first trusted Gmail receiver verdict into a redacted provider-neutral projection; copied or untrusted results remain unavailable. `server/email/icloud.ts` preserves ordered original headers from its bounded IMAP source and uses `evaluateICloudSenderAuthentication` for the observed Apple gateway/ingress and split-result layout. Missing, truncated, duplicate, or unsupported iCloud evidence remains unavailable. Both paths rely on the receiving provider to sanitize forged authentication headers. `server/email/email-index.ts:indexEmails` persists that projection alongside the email, then `server/email/verification-code-detector.ts:detectVerificationCode` atomically replaces nullable code metadata without an external/model call or persisted evidence
4. `server/email/gmailTriageStatements.ts:triageStatementsForEmail` — inserts a pending `ea_email_triage` row and an arrival-grace-scheduled triage job
5. `server/snapshots/snapshot-triage-attachment.ts:attachArrivalGraceEmailToActiveSnapshot` — upserts a queued-lane snapshot item, publishes `email_triage_queued`
6. `server/scheduler.ts:requestEmailTriageDrainAt` / `runEmailTriageWorker` — successful arrival-grace writes arm one process-local timer for the earliest durable `scheduled_for`; startup and completed drains rediscover the earliest queued timestamp, a timer firing during an active drain queues one follow-up check, and a five-minute cron remains restart/missed-signal/stale-claim recovery (jobs are also drained inline by `server/snapshots/snapshot-service.ts:syncActiveSnapshot`)
7. `server/triage/triage-worker.ts:processNextEmailTriageJob` — claims the job, handles skip/defer/grace branches
8. `server/triage/triage-worker.ts:routeEmailForTriage` — preflight rules, then cheap-model classification with strong-model escalation.
9. `server/triage/triage-finalize-store.ts:updateTriageRow` — persists the decision (lane, summary) to `ea_email_triage`.
10. `server/triage/triage-finalize-store.ts:attachToActiveSnapshot` — upserts `ea_briefing_snapshot_items` with the decided lane
11. `server/dashboard/current-events.ts:publishCurrentDashboardEvent` — fans `email_triage_finalized`/`email_triage_failed` to SSE subscribers
12. `src/hooks/dashboardEventRefreshModel.ts:refreshScopeForDashboardEvent` / `src/hooks/useCurrentDashboard.ts:handleChanged` — forwards the payload to the dashboard event handler, routes `email_triage` to the existing active-snapshot read, and keeps every other or unknown source on the full-current read; queued bursts retain the strongest pending scope and snapshot-read failure falls back once to full current
13. `server/snapshots/snapshotStore.ts:loadSnapshotItems` → `server/snapshots/snapshotViewModel.ts:buildSnapshotView` → `src/components/inbox/inboxWorkItems.ts:collectActiveSnapshotEmails` — joins verification metadata, promotes a still-fresh candidate into active Needs You without rewriting its durable lane, then flattens snapshot lanes into normalized inbox rows; expiry/frozen history strip the actionable metadata and retain the stored lane
14. `src/hooks/useTriageNotificationSounds.ts:handleDashboardEvent` — resolves the sound for the trigger type
15. `src/lib/triageSoundGate.ts:createTriageSoundGate` — gate's accept() dedupes by eventKey and coalesces per trigger (4s window)

**Caches:** `ea_gmail_watch_state` history cursor (`server/email/gmail-sync.ts`, reset on 404 recovery); `ea_email_index` (`server/email/email-index.ts`, including nullable verification metadata whose active deadline derives from the normalized email timestamp); `ea_triage_jobs` queue + `ea_email_triage` decisions (written by the sync, settled by the worker); `ea_briefing_snapshot_items` (upserted at queue-attach and finalize; never rewritten for verification promotion); sessionStorage `ea_triage_sound_event_keys` (`src/lib/triageSoundGate.ts`, capped 200).

**SSE:** `dashboard-current-changed` (reasons `email_triage_queued`/`email_triage_finalized`/`email_triage_failed`) — emitted by `server/dashboard/current-events.ts:publishCurrentDashboardEvent`, streamed by GET `/current/events` in `server/routes/dashboard.ts` — consumed by `src/hooks/useCurrentDashboard.ts:handleChanged`, routed to `src/hooks/useTriageNotificationSounds.ts` via `src/pages/Dashboard.tsx`.

**UI:** inbox lanes (`src/components/inbox/InboxView.tsx` → `src/components/inbox/InboxDesktopPane.tsx` / `src/components/inbox/mobile/MobileInboxView.tsx`): email appears in Queued during arrival grace, moves to its decided lane after classification; lane counts in `src/components/inbox/DigestStrip.tsx`; one gated notification sound per eventKey.

**Removal:** Inbox trash retains its six-second undo window and commits on leaving Inbox. Every trash scope, including indexed search, refreshes the shared active snapshot after the provider mutation completes. `snapshot-service.ts:markProviderRemovedFromActiveSnapshots` publishes `email_triage` / `email_provider_removed` after removing active rows from the view, so provider reconciliation and other open consumers update Dashboard without a manual refresh. Removal events have no sound trigger.

**Sound admission:** SSE and queued-snapshot fallback use the same email arrival-date freshness check and current-visit cutoff. Initial queued rows and pre-visit mail stay silent, including rows discovered by a later sync. Returning from a hidden document or the back/forward cache advances the visit cutoff and cancels pending playback. Playable background arrivals remain eligible. Document activation, rather than a sessionStorage flag alone, gates automatic playback when the browser exposes it. Queued work and browser audio startup expire after two seconds; pending resume/play is cancelled on expiry or teardown, so blocked audio cannot accumulate a return-visit backlog.

**Timing:** `server/email/email-arrival-timing.ts:projectEmailArrivalTiming` emits non-sensitive `[EA Timing]` evidence when a history job settles. `providerDeliveryMs` is Pub/Sub `publishTime` → durable history-job `created_at`; `historyQueueWaitMs` is durable enqueue → worker claim; `historySyncMs` is claim → completed Gmail fetch/index/snapshot attachment; `providerToQueuedMs` is Pub/Sub publish → durable triage rows ready for snapshot attachment; `snapshotAttachmentMs` is that durable milestone → history-job completion. Arrival-grace `scheduled_for` is the intentional classification boundary; the deadline wake-up removes cron-alignment jitter after that boundary without shortening grace. Missing/malformed timestamps omit dependent durations, and clock-skewed stages clamp to zero with validity metadata. `src/hooks/useCurrentDashboard.ts` separately measures `dashboard-event-refetch` from SSE receipt to accepted state dispatch with `performance.now()`, records the selected `active_snapshot` or `current` scope (including fallback scope), and does not log stale superseded responses as completed.

## 2a. Email AI calls → durable usage → analytics

1. Triage worker/classification entry points establish an async-scoped owner/origin/run identity. Nested work inherits it; evaluation entry points mark an evaluation context that bypasses usage preparation and database recording entirely while preserving the provider result/error. Real triage evaluations require `EA_USER_ID` or an explicit owner to load model settings, never a fixture-label owner.
2. `server/platform/ai-usage.ts:trackedAiProviderCall` wraps each actual HTTP attempt in the triage provider adapters. Purposes are `triage_cheap` / `triage_strong`. Retries and concurrent attempts have independent UUIDs.
3. Returned envelope usage is saved before semantic parsing; the same event then becomes succeeded or parse-error. Transport/HTTP/envelope failures retain an attempt with unknown usage. Later workflow failure never deletes usage. Provider latency ends at envelope capture; existing triage latency remains end-to-end classification/verification time.
4. `ai-usage-tokens.ts` normalizes total input including cache reads/writes (Anthropic reports these separately; OpenAI includes them). Standard text price estimates are snapshotted with a version; unknown models/tiers, unsupported long contexts, and missing/invalid usage remain unpriced. No prompts, bodies, credentials, or raw error strings enter the ledger. Migration `072_ai_usage_diagnostics.sql` adds nullable diagnostics: allowlisted response status and stop reason, configured output-token limit, reported reasoning tokens, and normalized failure code. Output-limit failures require an explicit provider stop reason; token counts alone do not establish truncation. Legacy calls retain null diagnostics.
5. Migration `057_email_ai_usage.sql` freezes only the old OpenAI latest-row usage projection and establishes the ledger boundary. `getTriageCacheStats` now reads that legacy snapshot, never mutable email rows. It remains incomplete history and is never added to event totals. No past dry-run, retry, or evaluation usage is invented.
6. Authenticated `GET /api/ea/email-ai/usage` rolls up the owner's last seven days by context, category, purpose and model. The Triage tab displays only production usage, with no context selector, and labels missing usage, unpriced subtotals, and unfinished outcomes. Existing evaluation records remain separate in the ledger/API and are excluded from these views; new tagged evaluation calls are not recorded. Each production category includes its latest 20 failed calls within the same owner/window bounds, with existing timing, HTTP status, tokens, origin and call/run IDs plus safe diagnostics. Expandable Recent failures rows show these measurements without fetching email content. Usage details contains the ledger start date and accounting explanations. Analytics does not fetch or display the legacy snapshot. Alfred and Email Search remain on their existing paths. Demo returns fictional in-memory data only.

**Accounting limits:** best-effort recording cannot stop processing. Each of its two writes waits at most 1.5 seconds; failures emit only an opaque event ID. Database outages and process death before capture can lose calls; a crash after capture can leave a response-received outcome. Timed-out writes may finish later, and idempotent terminal transitions prevent regression. This is not provider invoice reconciliation, a replay queue, or historical backfill. Raw ledger events remain durable beyond the UI's rolling window.

## 3. Snapshot / briefing lifecycle

**Trigger:** cron boundary advance — `server/scheduler.ts:initScheduler` (per-user schedule) calls `server/snapshots/snapshot-service.ts:advanceSnapshotBoundary`; snapshots are also created lazily on any read via `server/snapshots/snapshot-service.ts:getOrCreateActiveSnapshot`.

1. `server/snapshots/snapshot-service.ts:advanceSnapshotBoundary` — freezes active snapshots at the boundary (active → frozen), inserts the new active row
2. `server/snapshots/snapshot-service.ts:copyCarryoverItems` — copies unresolved needs_attention/queued items into the new snapshot
3. `server/snapshots/snapshot-triage-attachment.ts:attachArrivalGraceEmailToActiveSnapshot` — new email lands in the queued lane (see flow 2)
4. `server/triage/triage-finalize-store.ts:attachToActiveSnapshot` — triage decisions land in their lanes (see flow 2)
5. `server/snapshots/snapshot-snooze-lifecycle.ts:deferPendingTriageForSnooze` — snoozing hides the item and reschedules its triage job to wake time
6. `server/snapshots/snooze-waker.ts:wakeDueSnoozes` — 5-min cron restores the active snapshot through snooze-restoration.ts before flipping snoozed → resurfaced
7. `server/snapshots/snapshot-snooze-lifecycle.ts:attachResurfacedSnoozeToActiveSnapshot` — upserts the resurfaced item, lane normalized by `server/snapshots/snapshot-state-machine.ts:resurfacedTriageLane`
8. `server/snapshots/snapshot-item-mutations.ts:moveSnapshotItemLane` — user lane transitions (plus handled/reopen mutations) via the snapshot item routes
9. `server/snapshots/snapshot-service.ts:getActiveSnapshotView` — loads items, derives lanes and read-only state, and supplies the view clock for 30-minute verification-code freshness (frozen snapshots are read-only)
10. `server/snapshots/snapshot-lifecycle.ts:normalizeSnapshotItem` → `server/snapshots/snapshotViewModel.ts:buildSnapshotView` — normalizes DB rows (lane, catch-up id, resurfaced flags, verification metadata), then promotes only fresh active candidates while preserving `lane_at_snapshot`; frozen/expired views expose no actionable code metadata
11. `server/dashboard/current-events.ts:publishCurrentDashboardEvent` — lifecycle changes publish dashboard events
12. `src/hooks/useCurrentDashboard.ts:handleChanged` — SSE-triggered refetch embeds the fresh snapshot view in the dashboard payload
13. `src/hooks/useActiveSnapshot.ts:useActiveSnapshot` — standalone fallback fetch; 15s poll while processing is active
14. `src/components/inbox/InboxView.tsx:InboxView` — renders snapshot lanes; read-only when frozen. Inbox projects carryover into its stored Needs Attention/Queued lane with a provenance label, keeping persistence and carry-forward eligibility unchanged. Catch-up remains separate; populated Untriaged Read remains accessible after settings changes.

**Caches:** single-flight sync map in `server/snapshots/snapshot-service.ts` (dedupes concurrent active-snapshot syncs); `ea_current_data_cache` rows in `server/dashboard/current-service.ts` (other providers; the active snapshot itself is fetched fresh); frontend snapshot state in `src/hooks/useActiveSnapshot.ts` and `src/hooks/useCurrentDashboard.ts`, overwritten on each refetch.

**Health:** current-dashboard reads/refreshes and `/api/dashboard/health` share `current-service.ts:loadProviderHealth` → `currentSystemStatusModel.ts:composeSystemStatus`, combining cache freshness with the authoritative task mirror and redacted connection/reauth evidence. Calendar dashboard refresh opts into complete provider reads: any account/list/calendar failure keeps the prior cached payload through the existing refresh runner. `useCurrentDashboard.ts` records full-read success independently of content deduplication; `currentDashboardHealthModel.ts` adds browser connection failures and advances source age while visible. Snapshot-only triage reads cannot clear a failed health check. Online/stream recovery revalidates the full envelope before restoring healthy status; retry polling recognizes in-progress work even while the last failed outcome remains visible. Shell details expose per-source impact/time and route repair to existing Connections controls. A source retry posts one allowlisted cache key to `/api/dashboard/current/refresh`, awaits only that source’s existing single-flight runner, and returns a read-only envelope; it never falls through to global cache refresh or email sync. The client applies this result without polling unrelated sources and reports pending, success, or continued failure in the row. Recovery metadata includes source-specific impact and active refresh evidence; automatic retry eligibility is not presented as a promised schedule. Failure-seeded cache rows do not count as successful data, and failed Todoist checks cannot become a successful retry merely because cached tasks remain readable.

**Deferred browsing:** GET /api/briefing/email/snoozed → email-service → snoozed-emails hydrates owner-scoped index/triage rows with captured-snapshot fallback. useSnoozedEmails refreshes on entry/focus and polls (30 seconds while browsing, 60 otherwise). Persisted snoozed status owns membership, including overdue retry rows. Browsing never creates snapshot membership; read state uses UID overrides. DELETE /email/:uid/snooze uses the same durable restoration as scheduled wake before settling deferred state. Missing-source early return fails without deleting the snooze.

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

**Caches:** per-month events cache in `src/hooks/calendar/useCalendarRange.ts` (30-min TTL, ±3-month prefetch radius; explicit sync and Calendar SSE invalidate outstanding generations while retaining saved rows, editor saves patch content); per-scope search snapshots in `src/hooks/calendar/useCalendarModalSearch.ts` (reset on query change/modal close, event search revalidates with calendar revision); server mirror `ea_calendar_search_occurrences` owned by `server/calendar/calendar-search-mirror.ts` (`syncCalendarSearchMirror` full/incremental behind one serialized request queue; `server/calendar/calendar-event-write-effects.ts` applies write-through upserts for single-event mutations and marks recurring edits dirty for async repair, then reconciles reminders).

**SSE:** `dashboard-current-changed` marks the relevant deadline/calendar range caches stale via `src/pages/Dashboard.refreshModel.ts`. Calendar success events follow the committed mirror/cache refresh; visible months and open event search then revalidate. Full normalized event content participates in dashboard stability, so an external title/location/description edit remains observable when event times stay unchanged.

**UI:** month grid + agenda render through `src/components/calendar/modal/CalendarModalShell.tsx`; search results in `src/components/calendar/modal/CalendarSearchRail.tsx`; activating a result repositions the grid, selects the day/item, and opens the floating detail.

## Google Calendar notification → durable sync → visible data

1. `server/calendar/calendar-push-channels.ts:reconcileCalendarPushWatches` discovers selected calendars and registers per-calendar Events watches (plus CalendarList when the existing grant supports it). Production uses the saved canonical HTTPS origin. Pending channel identity and a random token hash are persisted before registration; renewal overlaps the old valid channel and failed discovery cannot retire it.
   A Google `400 / pushNotSupportedForRequestedResource` response marks only that event collection as unsupported for the attempted watch's seven-day lifetime. It remains in periodic data synchronization, is excluded from required watch counts, and is not treated as a retryable registration failure. Migration `075_calendar_push_unsupported.sql` persists this capability evidence across restarts.
2. `server/routes/calendar-push.ts` is mounted before browser CSRF middleware. `acceptCalendarPushNotification` validates channel/resource/token identity, expiry and current account eligibility, then commits receipt evidence and an owner queue revision atomically. The route returns 204 only after durable acceptance; persistence failure returns 503.
3. `server/calendar/calendar-push.ts` coalesces bursts and drains the revision queue. `refreshCalendarSearchMirror` waits through the shared mirror scheduler; strict discovery and incremental token repair retain provider failure evidence. `refreshCalendarCurrentData` waits out an older dashboard read and refreshes only Calendar.
4. Completion advances only the revision captured before the fetch, preserving changes received during work. Failures stay pending with bounded retry delay and visible persisted health. Successful work publishes `calendar` / `calendar_push_synced`; channel checks publish a separate health-only source. CalendarList and account changes request registration reconciliation.
5. The worker drains every minute and schedules recovery after fifteen minutes without a successful sync. Watch discovery/renewal runs hourly with five-minute failure retry. Shutdown awaits admitted work; queue state survives restarts. The old standalone mirror interval is replaced at server startup.
6. Calendar system health has a one-hour successful-read deadline while its data cache keeps the five-minute refresh TTL and recovery checks remain every fifteen minutes. Ordinary refresh remains quiet; synchronization/watch failures, overdue data and connection/reauth failures remain explicit. Notifications and watch configuration do not advance data freshness on their own.

## Calendar typed create seed → existing editor → normalized completion

**Trigger:** an internal dashboard caller, including a validated Alfred proposal card, invokes `openCalendar` with an optional typed `eventCreateRequest`.

1. `shared/types/calendar.ts` — defines the serializable seed fields, optional resolved/requested source intent, opaque client origin, acknowledgement, and normalized completion values
2. `src/components/dashboard/useCalendarWorkspaceState.ts:openCalendar` — stores one pending request, forces Events create routing through the existing open-request counter, and clears only the identity-matching request after acknowledgement
3. `src/components/dashboard/DashboardCalendarModalMount.tsx` → `src/hooks/calendar/useCalendarModalController.tsx` — forwards the in-memory request into Calendar without persistence or provider serialization
4. `src/hooks/calendar/useCalendarOpenRequestRouting.ts` — consumes each request ID once across initial lazy mount and later mounted opens; unavailable/rejected editor routing emits failure without opening a false editor shell
5. `src/components/calendar/events/useCalendarEventEditorSession.ts` — normalizes the seed into the existing draft, marks schedule/location as manual, resolves omitted/resolved/requested source behavior against writable sources, and accepts after the same-session source attempt
6. `src/components/calendar/events/useCalendarEventTitleComposer.ts` — suppresses parsing only for the untouched structured title; owner title edits re-enable assistance while seeded schedule/location manual overrides remain authoritative
7. `src/components/calendar/events/useCalendarEventMutations.ts:save` — the existing **Create event** action remains the sole write boundary; validation/provider failures retain the draft and emit no completion
8. `src/hooks/calendar/useCalendarEditorScrollRouting.ts` → `src/hooks/calendar/useFloatingEditorRouting.ts:handleEventEditorSaved` — preserves the existing saved-event detail transition
9. `src/components/calendar/events/useCalendarEventEditor.ts` — after detail routing, consumes the retained request once and returns the same normalized saved event plus unchanged origin; cancel clears coordination without completion

**State:** seed, origin, callbacks, and requested source name are mounted-client-only and are never persisted. Requested-name resolution covers sources returning within the same editor session; the existing full-page Gmail OAuth reconnect cannot retain this state under the no-persistence contract. Explicit routing/editor/seed failures are acknowledged; lazy chunk-load failures remain owned by the app-level recovery boundary and are outside this narrow bridge.

## Alfred owner request → ephemeral proposal → Calendar-owned commit

**Trigger:** the owner explicitly asks Alfred to create or revise one calendar event, optionally with a deliberately attached untrusted email.

1. `POST /api/alfred/run` keeps each owner message outside the email trust fence and records it separately as an ephemeral trusted-owner turn. Failed runs roll that trusted boundary back with the provider transcript.
2. `propose_calendar_event` semantically interprets natural owner language without a keyword list, but must copy the complete authorizing owner message. `alfred-calendar-proposals.ts` resolves that evidence against an unconsumed trusted turn, allowing Alfred clarifications without making the owner repeat the request; email text can never satisfy the provenance check. The policy still rejects unsupported fields, invalid schedules, and unowned named calendars; resolves relative dates against owner-now or the email timestamp according to phrase source; and checks exact duplicates.
3. The run loop holds one proposal in a run-local slot. Only a successful provider turn commits it to the in-memory conversation and emits `calendar_proposal` immediately before `run_end`; failure leaves the prior proposal active.
4. `AlfredCalendarProposalCard` renders the validated structured proposal. **Review in Calendar** maps it directly to the typed Calendar seed and performs zero event writes.
5. `DashboardShell` opens Calendar without first closing Alfred. The Calendar request router retries transient editor-ref unavailability for a bounded four-frame readiness window on the first lazy mount. After seed acceptance, floating routing observes a bounded DOM-readiness window for the matching event ghost and anchors the editor to that chip, falling back to the day cell only when no matching ghost appears before the timeout. The panel closes only when the existing editor acknowledges seed acceptance; terminal rejection keeps the proposal and exposes **Try again**.
6. The editor's existing **Create event** action performs the sole provider write. Its normalized completion value updates the still-mounted Alfred card to Created and enables **Open event**.
7. The client posts only conversation/proposal identity to the Created acknowledgement route. Calendar save remains locally authoritative if that coordination call fails, and the identity is retried on the next Alfred run.

**State:** proposal identity/status/duplicate fingerprint and expiry are process-local conversation state; the normalized created event is mounted-client state only. Neither proposal nor saved-event content is durable Alfred storage.

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

**State:** the multi-selection set lives in `src/hooks/calendar/useCalendarEventSelectionSet.ts` (React state + ref mirror, hosted by the controller), shaped by `src/components/calendar/events/calendarEventSelectionModel.ts`; client-only, never persisted. The single day/item focus is separate, owned by `src/hooks/calendar/useCalendarModalSelection.ts` + `src/hooks/calendar/calendarModalSelectionModel.ts`.

**SSE:** none — purely client-side state.

**UI:** selected chips get the selection accent border/wash on every surface; first modifier-click closes any open detail/editor; bare cmd/ctrl promotes-or-dismisses; plain click anywhere clears the set.

## 6. Process shutdown → scheduler drain

**Trigger:** SIGTERM/SIGINT enters `server/shutdown.ts:createGracefulShutdown` through `server/index.ts`.

1. `server/shutdown.ts:createGracefulShutdown` — starts the 15-second force-exit deadline, stops accepting HTTP work, then runs background stop functions in order
2. `server/scheduler.ts:stopScheduler` — synchronously closes cron, interval, startup-timeout, and queued-immediate admission sources; repeated calls share one promise
3. `server/scheduler-work-registry.ts:createSchedulerWorkRegistry` — awaits every scheduler-owned task already running, including scheduler initialization, index sweep, Gmail watch/history work, triage/prune work, embeddings, reminders, and snapshot-boundary callbacks
4. `server/shutdown.ts:createGracefulShutdown` — exits cleanly after all stop functions settle; a stuck task remains bounded by the existing force-exit timer

**Durability:** shutdown does not rewrite queue state. Forced exits continue to recover through the existing stale-lock and durable cron fallback paths.

## 7. First-run owner claim → authenticated runtime

**Trigger:** the SPA reads `GET /api/auth/setup/status` before normal session auth. A missing `ea_owner` singleton routes the browser to `/setup`.

1. `src/pages/OwnerSetup.tsx` — prefills the visible browser origin, requires the out-of-band deployment setup token, explicit canonical-URL confirmation, and a matching password of at least 12 characters, then sends them to `POST /api/auth/setup/claim`.
2. `server/routes/auth.ts` — rate-limits the claim and constant-time verifies `EA_SETUP_TOKEN` before any owner write; the token is never persisted or returned. `server/auth/owner-claim-service.ts:claimInitialOwner` then generates a stable UUID and bcrypt hash.
3. `server/auth/owner-store.ts:claimOwner` — one write transaction uses `INSERT OR IGNORE` against singleton key `1` and persists the confirmed origin in separate `ea_instance_metadata`; the uniqueness invariant admits one concurrent claimant and all others receive the fixed conflict.
4. `server/auth/recovery-code-store.ts:replaceRecoveryCodes` — generates eight high-entropy offline recovery codes, persists only SHA-256 hashes, and returns plaintext only in the successful claim response.
5. `server/middleware/auth.ts:createSession` — persists only the hashed session token plus authentication method, password-proof timestamp, and owner security generation; insertion succeeds only while that generation is current. The successful browser receives the raw token in an HttpOnly cookie.
6. `server/auth/owner-context.ts:activateOwner` — exposes the claimed ID to remaining single-owner runtime modules and notifies startup gating.
7. `server/auth/owner-runtime.ts:createOwnerRuntimeGate` — starts schedulers and provider workers once, only after a stored or newly claimed owner exists.

**Compatibility:** `server/auth/owner-bootstrap.ts:resolveOwnerBootstrap` runs after migrations and before listen. It imports an exact legacy `EA_USER_ID`/`EA_PASSWORD_HASH` pair into `ea_owner`, preserves the bcrypt hash and ID, and fails closed for partial or conflicting state.

**Canonical origin:** `server/platform/canonical-url.ts` imports compatible legacy WebAuthn/Google callback values only when they identify one origin. Persisted state then drives WebAuthn RP values and Google, Todoist, Gmail Pub/Sub, and webhook callback projections. Security Settings previews affected passkeys and callback registrations before a recent-auth-gated change; request headers never write canonical state.

**Pre-claim boundary:** `server/middleware/owner-gate.ts` returns a fixed setup-required response for non-setup APIs. `GET /healthz` remains successful and reports readiness only; `GET /api/auth/setup/status` is the explicit setup-state endpoint. Demo mode resolves setup as already claimed and rejects claim mutations locally without a network call.

## 8. Owner sign-in, step-up, and offline recovery

**Normal mode:** `ea_owner.auth_mode = password_or_passkey`. A valid password issues a session directly. Passkey options may instead create a short-lived `ea_pending_auth` binding, and successful WebAuthn verification consumes its challenge before issuing the same session type. Registering a passkey does not change this mode.

**Password login throttle:** every password login reserves one of ten owner-wide attempts in a fixed fifteen-minute window, atomically in `ea_owner` before password verification, alongside the five-per-IP limit. Successful attempts also count, avoiding concurrent reset races. Exhaustion returns `429` with `Retry-After`; rejected attempts do not extend the window. The budget survives process restarts and security transitions. Existing sessions, passkey-only login in normal mode, and recovery remain independent; strict mode still requires both factors.

**Session storage:** only the hash of the presented cookie is looked up; raw legacy rows and cookies containing the stored `sha256:` format are rejected. Migration 060 revokes all prior sessions and pending ceremonies and advances the owner generation once, requiring browsers to sign in again without changing passwords or passkeys.

**Strict mode:** the owner explicitly changes `auth_mode` to `password_plus_passkey` through a recent-password-protected Security action. Password login then creates generation-bound pending auth and WebAuthn completes the session. Mode, password, passkey, recovery-code, and canonical-origin mutations require `ea_sessions.password_authenticated_at` to be within ten minutes. A passkey-only session cannot cross that boundary; password confirmation failures are counted and blocked in the durable session row.

**Security transitions:** each sensitive mutation compare-and-swaps `ea_owner.security_generation` inside the same write transaction as the credential change, then clears every browser session plus owner pending-auth and WebAuthn state. The initiating browser receives a new generation-bound session after commit. Atomic `DELETE ... RETURNING` consumption prevents concurrent reuse of a challenge or pending-auth token.

**Security Settings unlock:** the System section never treats the server's remaining recent-auth window as permission to reopen sensitive password, passkey, recovery, or auth-mode controls. `PasskeysCard` starts locally locked on every mount, so switching Settings sections, navigating away and back, or refreshing requires the dashboard password again. A `pagehide` lock also clears sensitive drafts and one-time recovery-code display before a browser back/forward-cache restore. The ten-minute server window remains the request-authorization boundary only while the current section visit is open.

**Recovery:** `POST /api/auth/recovery` rate-limits and atomically consumes one unused recovery-code hash. Success replaces the password, returns mode to password-or-passkey, clears passkeys, pending auth, WebAuthn challenges, and prior sessions in one security transition, issues a fresh non-password-provenance session, and returns a newly generated recovery-code set exactly once.

**Pending provider credentials:** write-only candidates expire 24 hours after staging. Registry reads lazily prune stale values, while tests, promotions, and OAuth callbacks compare the exact candidate version and require its expiry to remain in the future. Google and Todoist app pairs are one atomic candidate: either both values remain current or both expire/discard together. Recent-password-protected discard endpoints are version-bound and remove only the pending candidate, preserving the active stored or environment-backed connection and returning metadata only.

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

## 10. Capability status projection

**Trigger:** authenticated consumers call `GET /api/capabilities`; `refresh=1` bypasses the short metadata cache.

1. `server/capability-status-service.ts` reads only allowlisted per-key registry metadata plus configured booleans, account reauth flags, and existing Actual, Todoist, and Gmail delivery evidence. It does not decrypt credentials or call providers.
2. `server/platform/capability-projection.ts` converts that injected evidence into independent stable capability states, redacted reason/action identifiers, sources, modes, and timestamps.
3. `server/routes/capabilities.ts` returns the shared metadata-only contract behind cookie authentication. Registry changes invalidate the cache; other persisted changes become visible through explicit refresh or the five-second TTL.
4. `src/api.ts:getCapabilities` uses the private endpoint in normal builds and the fictional inert projection in demo builds.

**Separation:** onboarding completion/progress is not part of capability health. Optional Gmail Pub/Sub, Todoist OAuth/webhooks, and Places states cannot degrade their base capabilities.

## 11. Authenticated onboarding progress → shared Settings workflows

**Trigger:** after an authenticated bootstrap or login, `src/App.tsx` reads onboarding progress. A newly claimed owner is sent to `/onboarding`; an owner whose checklist was explicitly finished continues to the dashboard.

1. `server/db/migrations/037_onboarding_progress.sql` — creates owner-keyed, versioned presentation progress and backfills owners present at migration time as finished so existing installations keep their current entry behavior.
2. `server/auth/owner-bootstrap.ts` → `server/onboarding-progress-store.ts` — matching legacy environment owners are initialized as finished after owner import, covering the production startup order where migrations run first. The insert is missing-row-only so an explicit reopen remains in progress.
3. `server/onboarding-progress-store.ts` — reads and allowlist-updates reviewed/completed/skipped step state separately from `completed_at`; finish and reopen change only the checklist lifecycle.
4. `server/routes/onboarding.ts` — exposes authenticated `GET` and allowlisted `PATCH` mutations without accepting provider values or returning secrets.
5. `src/lib/onboardingApi.ts` — uses the authenticated API normally and an in-memory, network-free projection in demo builds.
6. `src/lib/onboardingModel.ts` — owns the locked capability order, allowlisted provider-specific Connections targets, first-unfinished projection, and the **Continue setup** destination (the first persisted `reviewed` step when present, otherwise the projected active step); none of these consult capability health.
7. `src/pages/Onboarding.tsx` — renders the resumable checklist, reads live `/api/capabilities` metadata, resumes an allowlisted `?step=`, and renders one explicit Connections action per provider so tests, OAuth, and write-only credential behavior are shared.
8. `src/pages/Settings.tsx` → `src/components/settings/ConnectionsDirectory.tsx` — fetches onboarding progress once at the page boundary; while the checklist is unfinished, the directory always shows **Continue setup** for the projected active step and never derives it from broken or disconnected services.
9. `src/components/settings/sections/ConnectionsSettingsSection.tsx` → `ConnectionPanelContent.tsx` — canonical connection hashes open the owning row; allowlisted `setup=gmail-realtime|todoist-advanced` query targets reveal and focus only that service's Advanced setup disclosure. Ordinary in-directory row toggles mark their navigation as local so they update hash/history without replaying inbound deep-link scroll, focus, or flash behavior.
10. `src/App.tsx` — keeps dashboard access available while unfinished, resumes the checklist from login, and observes finish/reopen events so an explicit finish is immediately non-blocking.

**Deep links:** base services use `/settings?tab=connections#<connection-id>`. Gmail realtime and Todoist advanced retain the owning connection hash and add an allowlisted `setup` query; deterministic legacy tab/card pairs are canonicalized, while ambiguous combined-card hashes are not guessed.

**Separation:** capability degradation never reopens onboarding or changes persisted presentation progress. An unfinished checklist always keeps a return path from Connections, including when the active step is untouched or skipped; explicit finish removes that path. Finishing is permitted with every integration pending, and demo onboarding/Settings use the in-memory progress adapter without calling setup, provider, or onboarding endpoints.

## 13. Alfred Settings selection → conversation-bound provider run

**Trigger:** the owner saves an Alfred provider/model in Settings, then starts a new Alfred chat.

1. `GET /api/ea/alfred-models` projects the centralized Alfred catalog with Anthropic discovery, curated OpenAI models, and credential availability.
2. `AlfredAiModelCard` writes `alfred_provider` and `alfred_model` together through the Settings autosave contract.
3. On the first `POST /api/alfred/run` without a live conversation, the route resolves the persisted pair, creates the in-memory conversation, and resolves that provider's credential.
4. `run_start` reports the bound provider/model; the panel shows it read-only. Later turns reuse the conversation ID and therefore keep the same pair even if Settings changes.
5. `alfred-run.ts` delegates each model turn to the bound Anthropic Messages or OpenAI Responses adapter while retaining the shared read-only tool execution, citation/grouping backstops, SSE events, and usage recording.
6. New chat deletes the old ephemeral conversation; the next first turn resolves Settings again. OpenAI runs use `store: false` and replay returned output/reasoning items locally rather than coupling to remote conversation state.

**Failure boundary:** a provider error rolls the local transcript back to the pre-run boundary. A missing credential is reported for the conversation's bound provider and never causes a silent cross-provider fallback.

## 14. Desktop email reader → deliberate Alfred context turn

**Trigger:** the owner clicks `Ask Alfred` on the currently open desktop-reader email.

1. `InboxDesktopPane` sends provider UID plus display metadata through the dedicated email handoff and opens the already-mounted Alfred conversation alongside the reader. The same conversation uses a centered workbench on other desktop pages. Alfred is desktop-only, so mobile exposes neither this action nor the panel; demo surfaces also omit the action.
2. `POST /api/alfred/email-context` fetches the authoritative provider body, converts it to bounded semantic text, preserves quoted/forwarded history and visible footer text, represents omitted image/file content with markers, and fences every email-controlled field as untrusted data.
3. The server stores that snapshot in the bounded owner-scoped in-memory context store and returns only an opaque context ID plus display metadata. No model/provider call occurs.
4. The composer shows a removable pending card and permits drafting while preparation runs; Send remains gated until the handle is ready. A later reader handoff replaces only the pending attachment and preserves the draft and current conversation. Suggestion buttons prefill an editable draft without a model call; only explicit Send submits it.
5. Send posts the owner prompt and context ID to `POST /api/alfred/run`. The route claims the handle and `alfred-run.ts` appends the fenced email plus owner prompt as one user turn.
6. `run_end` consumes the handle and leaves an immutable email reference above the sent prompt. Failure releases the handle, marks the attempt failed, and restores the prompt and attachment for retry unless the owner has already supplied a newer draft or attachment. Stop cancels the fetch stream and propagates response disconnect to the provider run.

**Caches/state:** one pending attachment in mounted panel state; short-lived server context handles (4-hour TTL, bounded per owner and process); the full body remains only in that in-memory handle and then the ephemeral provider-replayed Alfred conversation.

**Failure boundary:** unavailable, expired, or oversized content is visible and cannot fall through to a prompt without its requested context. Provider context overflow restores both inputs and offers a New chat recovery that preserves them.

## 15. Home settings → initial Time-to-Leave route → durable dynamic reminder

**Trigger:** the authenticated owner saves or clears Home through `PUT /api/ea/settings`, then creates a `time_to_leave` reminder through `POST /api/ea/reminders` for one future timed calendar occurrence.

1. `server/routes/settings.ts` → `server/platform/settings-schemas.ts` — accepts Home only as one complete address/place-ID/coordinate tuple (or one complete clear), persists it in `ea_settings`, and returns it only through the reviewed Settings allowlist.
2. `shared/types/reminders.ts` → `server/routes/reminders.ts` — discriminates legacy `fixed` creation from `time_to_leave`; dynamic input carries one event identity, start, physical location, recurrence flag/occurrence identity, and optional 0–120 minute arrival buffer.
3. `server/reminders/time-to-leave-model.ts` — rejects unsupported sources, missing recurring occurrence identity, all-day/past events, non-physical locations, and invalid buffers before provider work; pure functions calculate the effective leave time and bounded next-check cadence.
4. `server/reminders/reminder-service.ts` → `server/reminders/time-to-leave-service.ts` — the existing reminders facade delegates dynamic creation, reads the current complete Home tuple, and performs provider work before any reminder insert.
5. `server/location-credentials.ts` → `server/platform/google-routes.ts` — resolves the existing internal `calendar.google_places_api_key` as the shared Maps Platform key and sends one `DRIVE` / `TRAFFIC_AWARE_OPTIMAL` Compute Routes request with the exact field mask `routes.duration,routes.distanceMeters`.
6. `server/reminders/time-to-leave-service.ts` — persists one pending `time_to_leave` row with normalized event location, initial duration/distance, effective `remind_at`, route check timestamps/status, and no Home coordinates or provider response body.
7. `src/components/settings/cards/HomeLocationCard.tsx` → `src/components/calendar/events/CalendarEventReminderChips.tsx` → `calendarEventEditorActions.ts` — Settings commits Home atomically; one eligible physical occurrence can stage a default 15-minute buffer; event mutation succeeds before the initial grounded reminder request is created.
8. `server/reminders/reminder-service.ts` → `server/scheduler-reminder-drain.ts` → `server/reminders/reminder-scheduler.ts` — persisted reminder mutations arm one process-local timer at the earliest delivery, retry, route-check, or event-anchor timestamp; startup/completed batches rediscover that timestamp durably, with a five-minute safety backstop. Each admitted batch first selects a bounded set of due dynamic rows, reloads exact current occurrence and Home state, calls Routes, and conditionally updates only when the reminder, Home tuple, and occurrence version still match.
9. `server/calendar/calendar-event-write-effects.ts` → `server/routes/settings.ts` — event start/location writes and Home replacement requeue pending dynamic rows; cancellation/deletion prevents an unsent delivery.
10. `server/reminders/reminder-scheduler.ts` → `discord-reminders.ts` — the same cycle re-selects due reminders after refresh, rejects dynamic delivery at/after event start, and sends one destination/drive/buffer Discord payload without Home data.
11. `src/api.ts` → `src/demo/apiAdapter.ts` — demo builds keep Home, writable calendar events, full dynamic reminder rows, filtering, and deletion in refresh-reset in-memory state; provider/network boundaries remain unreachable.

**Failure boundary:** transient Routes failure retains the last grounded leave time with a redacted error code and bounded retry. Missing/ambiguous occurrence or Home state blocks the row, and CAS rejection discards stale provider results rather than reviving changed/deleted/sent state.

## 16. Desktop Notes edit → quiet revisioned tldraw save

**Trigger:** the owner opens desktop Notes, edits the tldraw document, or adds supported image/video media.

1. `DashboardShell` lazy-mounts `NotesTab` only after an eligible desktop visit; mobile and demo builds omit the tab, warm import, mount, and API traffic.
2. `loadTldrawWorkspace` performs a fresh `GET /api/tldraw/bootstrap` on every Notes mount and reads the device-local IndexedDB recovery envelope. A compatible draft based on the returned revision is restored automatically; a document-identical envelope is cleared; divergent documents require an explicit server/local choice and retain a recovery download.
3. The bootstrap response also returns whether production requires a license and the active tldraw key when required. Local development returns no key and mounts tldraw in its license-exempt development mode. Camera and active-page session state remain device-local in localStorage.
4. `useTldrawAutosave` observes only user-authored document changes. It writes the latest full recovery envelope to IndexedDB on a 350 ms bounded throttle, forces that write at lifecycle leave seams, and registers `beforeunload` only while current unsaved work is not protected locally.
5. Server autosave retains its five-second quiet window and thirty-second sustained-activity cap, allows one request in flight, coalesces newer changes, and skips a client-identical snapshot. A confirmed save clears only the exact recovery draft that matches it; a newer edit survives and is rebased to the new server revision.
6. `PUT /api/tldraw/document` compares the base revision, hashes the serialized document, skips hash-identical writes, and stores changed JSON as one gzip BLOB in `ea_tldraw_documents`.
7. A stale revision returns `409`; autosave stops and requires reload or an explicit local recovery download. No stale device silently overwrites a newer document.
8. `tldrawAssetStore` hashes supported image/video bytes in the browser and uploads a content hash once per mounted session. `tldraw-asset-service` verifies the hash, deduplicates on disk, and serves private immutable authenticated URLs from the persistent asset directory.

**Network boundary:** no polling, SSE, WebSocket, realtime presence, or per-keystroke writes. A second device sees the latest canvas after refresh. tldraw's hobby-license telemetry is governed by tldraw and is the only expected vendor traffic from the canvas itself.

**Persistence:** confirmed document BLOB/revision in the application database (persistent SQLite on the owner’s Debian host); current unsaved recovery envelope in device-local IndexedDB; content-addressed media on the private persistent disk; session/camera in localStorage. Legacy note rows, APIs, demo data, and UI do not exist.


## Dashboard Today notices

Today notices read persisted calendar-event reminders and match account, calendar, event and occurrence before displaying a Time-to-Leave estimate. Overlap detection uses remaining timed events today. Opening either notice reuses the calendar event detail route; dashboard never creates routes or enrolls reminders.

## Provider health and inbox check freshness

The current-dashboard system indicator separates cache refresh eligibility from successful-provider-check deadlines: Weather 60 minutes (30-minute refresh cache), Calendar 60 minutes (five-minute refresh cache and fifteen-minute recovery checks), and Tasks 60 minutes (webhooks plus a five-minute recovery sync). Failed checks, pending changes and reconnection requirements stay visible inside these age allowances. The older of the delivered cache and upstream mirror bounds freshness; local reads cannot renew the provider timestamp. Browser health expires these deadlines while a tab is open, including during a refresh.

Pirate Weather returns its original provider success timestamp on cache hits and awaits an expired provider fetch; the dashboard runner already provides saved-data background refresh. Failures retain the previous persisted weather rather than recording a cached fallback as a new success.

Each ten-minute scheduled inbox sweep records per-account success only after strict recent-inbox acquisition, indexing and triage queue admission all succeed, including an empty inbox. Migration `078_email_sync_health.sql` starts existing accounts with no invented success. Gmail's age-only health deadline is 60 minutes, allowing its Pub/Sub updates and recovery sweeps time to work; polling-only iCloud retains 20 minutes. The active-refresh guard remains 20 minutes for both providers. Failed account checks preserve the earlier timestamp and do not block healthy accounts. This measures inbox ingestion, not completion of AI triage or historical backfill. Known Gmail history jobs remain pending or failed until settled; watch registration and cursor seeding do not establish ingestion health. The status endpoint reads this evidence without provider calls; loader failures remain unavailable. The existing connection links lead to account repair, and automatic sweeps recheck health.


Explicit operator acknowledgment changes only selected terminal Gmail history failures to `acknowledged`, with an acknowledgment time and reason from migration 079. The original error, payload, attempts and failure timestamps remain unchanged, and no completion timestamp or provider success is manufactured. The dry-run-first maintenance command binds the owner, IDs, reason and full job snapshot to a fingerprint; application validates the entire selection in one write transaction. Acknowledged jobs stay outside worker claims, current health warnings and completed-job pruning. Later failures, pending jobs, reconnect requirements and failed/overdue inbox checks remain visible. This accepts historical uncertainty, not proof of recovery.

The shell groups per-account email health only after browser freshness projection. One Email row reports the worst account state and account count; its bounded disclosure lists only accounts needing attention, most severe first. Healthy accounts do not create individual rows. Server and browser freshness still use independent per-account evidence.
