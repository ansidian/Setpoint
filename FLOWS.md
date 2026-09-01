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

### Financial-email planning before the owner-confirmed write

1. `server/bills/financial-email-planner.ts:planFinancialEmail` accepts email context or a persisted semantic candidate without mappings, profiles, target policies, or automation modes. `server/bills/financialEmailIdentity.ts:financialEmailIdentity` adds a versioned one-way identity from the provider message/account plus an optional per-candidate hint; missing provider identity fails closed.
2. A missing candidate uses the existing first-pass extractor. A persisted complete candidate skips provider work; a candidate with missing/uncertain event semantics receives only the existing bounded verification pass.
3. `server/bills/financialEmailClassificationPolicy.ts:classifyFinancialEmail` returns document purpose separately from intended operation; `server/bills/billSemanticAmountPolicy.ts:selectSemanticBillAmount` supplies the canonical non-minimum amount policy shared with the legacy resolver.
4. The planner reads current Actual metadata plus at most 365 days/1,000 rows of transaction history. Projected transfer schedules carry the related transfer account so both sides can be inferred without a mapping.
5. `server/bills/financialEmailTargetInference.ts:inferFinancialEmailTargets` resolves targets in locked order: unique compatible last-four, exact schedule/payee, two-or-more fully consistent direction-aware history rows, conditional category history, then constrained ranking. Candidate-carried target IDs are cleared and never treated as evidence.
6. `server/bills/financialEmailTargetRanker.ts:rankFinancialTargetBundles` exposes only opaque keys and owner-facing bundle descriptions to the provider; invalid keys, confidence below 0.8, non-verbatim evidence, or provider failure remain unresolved.
7. `server/bills/statementActualStatusModel.ts:resolveStatementActualStatus` reconciles the inferred plan. Exact duplicates become no-write; a same-schedule amount/date-only mismatch is represented as `disposition: "update_existing"` without expanding the operation union; other conflicts remain review. `server/bills/financialEmailAutomationPolicy.ts:financialEmailAutomationEligibility` then projects semantic, amount/date, target, sender-authentication, stable-identity, warning, reconciliation, Actual-preflight, and per-class rollout gates. Every operation class is currently observe-only.
8. `server/triage/triage-worker.ts:processNextEmailTriageJob` plans every new triage financial candidate before `triage-finalize-store.ts:updateTriageRow` atomically persists the candidate and complete plan.
9. `server/bills/financial-email-adoption-service.ts:resolveFinancialEmailSeed` returns a stored valid plan without provider work; historical candidates without a plan use the same planner and compare-and-swap persistence.
10. `server/routes/briefing/bills.ts` routes both Inbox seed resolution and manual Extract Bill through the planner. Manual pasted extraction is returned to the caller and is not persisted.
11. `src/components/inbox/reader/useBillPayResolver.ts` caches the plan per selected email; `BillBadge.tsx` consumes its purpose, inferred destination, reconciliation, and review reasons while touched fields remain owner-controlled.

**Writes:** planning and `server/bills/financial-email-observe-report.ts:readFinancialEmailObserveReport` never write to Actual. The report only aggregates persisted plans by operation class. `src/components/bills/useBillBadgeForm.ts:handleSend` remains the only bill-form write trigger, and no-write plans keep that action disabled.

**Legacy configuration:** Bill Pay Settings contracts/cards and `/bills/resolve-sample` are retired. Stored `bill_pay_mappings_json` data is retained untouched for recovery, and the internal legacy resolver modules remain for a second Package 6 slice after planner tests own their residual behavior. Transaction-import modes and mappings remain the live safety gate until Package 4 replay evidence permits their retirement.

## 2. Email sync → inbox triage

**Trigger:** Gmail Pub/Sub push (POST `/api/gmail/push` → `server/routes/gmail-push.ts`) durably enqueues a history sync via `server/email/gmail-sync.ts:enqueueHistorySyncFromPubSub`, acknowledges the webhook, then requests an immediate coalesced drain via `server/scheduler.ts:requestGmailHistorySyncDrain`; the per-minute cron remains the reliability fallback.

0. `server/email/gmail-pubsub.ts:verifyToken` — performs one narrow shared-database hash/tombstone read for every delivery, hashes the candidate, and compares fixed-length hashes with `timingSafeEqual`; no TTL cache is used, so rotation/revocation is immediate across processes and restarts. Database failure returns a retryable `503` without queueing work or logging token material.
1. `server/email/gmail-sync.ts:processNextGmailHistorySyncJob` — claims a queued job, loads the account
2. `server/email/gmail-sync.ts:syncGmailHistoryForAccount` — pages Gmail history, fetches new messages, reconciles read/removal state
3. `server/email/email-index.ts:indexEmails` → `server/email/verification-code-detector.ts:detectVerificationCode` — parses and writes emails into `ea_email_index`; the local deterministic detector atomically replaces nullable code metadata without an external/model call or persisted evidence
4. `server/email/gmailTriageStatements.ts:triageStatementsForEmail` — inserts a pending `ea_email_triage` row and an arrival-grace-scheduled triage job
5. `server/snapshots/snapshot-triage-attachment.ts:attachArrivalGraceEmailToActiveSnapshot` — upserts a queued-lane snapshot item, publishes `email_triage_queued`
6. `server/scheduler.ts:requestEmailTriageDrainAt` / `runEmailTriageWorker` — successful arrival-grace writes arm one process-local timer for the earliest durable `scheduled_for`; startup and completed drains rediscover the earliest queued timestamp, a timer firing during an active drain queues one follow-up check, and a five-minute cron remains restart/missed-signal/stale-claim recovery (jobs are also drained inline by `server/snapshots/snapshot-service.ts:syncActiveSnapshot`)
7. `server/triage/triage-worker.ts:processNextEmailTriageJob` — claims the job, handles skip/defer/grace branches
8. `server/triage/triage-worker.ts:routeEmailForTriage` — preflight rules, then cheap-model classification with strong-model escalation
9. `server/triage/triage-finalize-store.ts:updateTriageRow` — persists the decision (lane, summary, bill candidate) to `ea_email_triage`
10. `server/triage/triage-finalize-store.ts:attachToActiveSnapshot` — upserts `ea_briefing_snapshot_items` with the decided lane
11. `server/dashboard/current-events.ts:publishCurrentDashboardEvent` — fans `email_triage_finalized`/`email_triage_failed` to SSE subscribers
12. `src/hooks/dashboardEventRefreshModel.ts:refreshScopeForDashboardEvent` / `src/hooks/useCurrentDashboard.ts:handleChanged` — forwards the payload to the dashboard event handler, routes `email_triage` to the existing active-snapshot read, and keeps every other or unknown source on the full-current read; queued bursts retain the strongest pending scope and snapshot-read failure falls back once to full current
13. `server/snapshots/snapshotStore.ts:loadSnapshotItems` → `server/snapshots/snapshotViewModel.ts:buildSnapshotView` → `src/components/inbox/inboxWorkItems.ts:collectActiveSnapshotEmails` — joins verification metadata, promotes a still-fresh candidate into active Needs You without rewriting its durable lane, then flattens snapshot lanes into normalized inbox rows; expiry/frozen history strip the actionable metadata and retain the stored lane
14. `src/hooks/useTriageNotificationSounds.ts:handleDashboardEvent` — resolves the sound for the trigger type
15. `src/lib/triageSoundGate.ts:createTriageSoundGate` — gate's accept() dedupes by eventKey and coalesces per trigger (4s window)

**Caches:** `ea_gmail_watch_state` history cursor (`server/email/gmail-sync.ts`, reset on 404 recovery); `ea_email_index` (`server/email/email-index.ts`, including nullable verification metadata whose active deadline derives from the normalized email timestamp); `ea_triage_jobs` queue + `ea_email_triage` decisions (written by the sync, settled by the worker); `ea_briefing_snapshot_items` (upserted at queue-attach and finalize; never rewritten for verification promotion); sessionStorage `ea_triage_sound_event_keys` (`src/lib/triageSoundGate.ts`, capped 200).

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
9. `server/snapshots/snapshot-service.ts:getActiveSnapshotView` — loads items, derives lanes and read-only state, and supplies the view clock for 30-minute verification-code freshness (frozen snapshots are read-only)
10. `server/snapshots/snapshot-lifecycle.ts:normalizeSnapshotItem` → `server/snapshots/snapshotViewModel.ts:buildSnapshotView` — normalizes DB rows (lane, catch-up id, resurfaced flags, bill candidate, verification metadata), then promotes only fresh active candidates while preserving `lane_at_snapshot`; frozen/expired views expose no actionable code metadata
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

**Caches:** per-month events cache in `src/hooks/calendar/useCalendarRange.ts` (30-min TTL, ±3-month prefetch radius; invalidated by explicit sync, patched by editor saves); per-scope search snapshots in `src/hooks/calendar/useCalendarModalSearch.ts` (reset on query change/modal close); server mirror `ea_calendar_search_occurrences` owned by `server/calendar/calendar-search-mirror.ts` (`syncCalendarSearchMirror` full/incremental + 15-min backstop worker; `server/calendar/calendar-event-write-effects.ts` applies write-through upserts for single-event mutations and marks recurring edits dirty for async repair, then reconciles reminders).

**SSE:** `dashboard-current-changed` marks bill/deadline range caches stale (via `src/pages/Dashboard.refreshModel.ts`) but does NOT touch the events month cache or the search mirror — those refresh via their own timers and explicit sync.

**UI:** month grid + agenda render through `src/components/calendar/modal/CalendarModalShell.tsx`; search results in `src/components/calendar/modal/CalendarSearchRail.tsx`; activating a result repositions the grid, selects the day/item, and opens the floating detail.

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

**Strict mode:** the owner explicitly changes `auth_mode` to `password_plus_passkey` through a recent-password-protected Security action. Password login then creates generation-bound pending auth and WebAuthn completes the session. Mode, password, passkey, recovery-code, canonical-origin, and powerful API-token mutations require `ea_sessions.password_authenticated_at` to be within ten minutes. A passkey-only session cannot cross that boundary; password confirmation failures are counted and blocked in the durable session row.

**Security transitions:** each sensitive mutation compare-and-swaps `ea_owner.security_generation` inside the same write transaction as the credential change, then clears every browser session plus owner pending-auth and WebAuthn state. The initiating browser receives a new generation-bound session after commit. Atomic `DELETE ... RETURNING` consumption prevents concurrent reuse of a challenge or pending-auth token.

**Security Settings unlock:** the System section never treats the server's remaining recent-auth window as permission to reopen sensitive password, passkey, recovery, or auth-mode controls. `PasskeysCard` starts locally locked on every mount, so switching Settings sections, navigating away and back, or refreshing requires the dashboard password again. A `pagehide` lock also clears sensitive drafts and one-time recovery-code display before a browser back/forward-cache restore. The ten-minute server window remains the request-authorization boundary only while the current section visit is open.

**Recovery:** `POST /api/auth/recovery` rate-limits and atomically consumes one unused recovery-code hash. Success replaces the password, returns mode to password-or-passkey, clears passkeys, pending auth, WebAuthn challenges, prior sessions, and API tokens in one security transition, issues a fresh non-password-provenance session, and returns a newly generated recovery-code set exactly once.

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

## 12. Email transaction discovery → durable Actual import

**Triggers:** Gmail history sync indexes a newly arrived message (`server/email/gmail-sync.ts:syncGmailHistoryForAccount`), or an authenticated historical-scan request enters through `POST /api/briefing/transaction-imports/runs` (`server/routes/briefing/transaction-imports.ts`).

1. `server/transaction-imports/transaction-import-arrivals.ts:ingestGmailTransactionArrivals` — receives only indexed message metadata plus the raw Gmail provider message ID; it never persists raw HTML and does not block Gmail sync completion.
2. `server/transaction-imports/transaction-import-service.ts:createTransactionImportService` — loads the temporary rollout mapping, applies `off`/`observe`/`automatic` mode, and parses the recognized merchant message into a canonical candidate or review-safe rejection.
3. `server/transaction-imports/transaction-import-planner-adapter.ts` → `server/bills/financial-email-planner.ts` — adapts exact parser identity/cents/warnings into the shared financial plan, infers targets only from Actual evidence, redacts body/model excerpts, and records a non-authoritative comparison with the mapped targets. A planner failure does not discard or promote the canonical import item.
4. `server/transaction-imports/transaction-import-store.ts` — owns mapping snapshots, run/page cursors, candidate identity uniqueness, redacted financial plans, shadow comparisons, conditional claims, retry ceilings, stale-claim recovery, manual corrections, and owner-scoped reads in `ea_transaction_import_mappings`, `ea_transaction_import_runs`, and `ea_transaction_import_items`.
5. `server/transaction-imports/transaction-import-runtime.ts` — admits immediate drains and runs the bounded 30-second reliability backstop; shutdown stops admission and awaits already-running work without rewriting durable state.
6. `server/transaction-imports/transaction-import-worker.ts` — resumes Gmail page cursors for historical scans, prepares and shadow-plans candidate batches, rejects missing live mappings or unsupported currencies to review, and performs an Actual dry run before any commit. Until equivalence evidence passes, mapped targets and source modes remain the live gate; the shadow plan cannot authorize a write.
7. `server/actual/actual.ts:importTransactionGroups` → `server/actual/actual-core.ts:importTransactionGroups` — sends account-grouped transactions through the existing in-process/worker Actual runtime using `@actual-app/api.importTransactions`; imported IDs are preserved unchanged, including legacy Amazon and PayPal formats.
8. `server/actual/actualTransactionImportModel.ts` — strictly validates grouped inputs, projects SDK rows, classifies compatible Actual outcomes, and keeps dry-run orchestration separate from commit orchestration.
9. `server/transaction-imports/transaction-import-worker.ts` — settles items as ready, imported, already imported, review, or failed using claim tokens; observe mode stops before commit, and automatic mode commits only candidates that passed the existing live safety gates.
10. `server/bills/bills-service.ts:invalidateActualAfterTransactionImport` — after a changed commit batch, clears Actual metadata and schedules exactly one bills-mirror refresh fan-out.
11. `server/routes/briefing/transaction-imports.ts` — exposes owner-scoped mapping, run, confirm, retry, dismiss, and resume controls behind briefing cookie authentication; clients poll durable run/item state, including redacted shadow-plan evidence.

**Caches/state:** durable mapping/run/item tables from migration 041; Gmail provider page token on the run; Actual metadata caches and bills mirror invalidated only after a changed commit. Raw email HTML is never stored.

**SSE:** none in phase 02. Imported Actual changes flow through the existing deferred bills-mirror refresh path.

**UI:** Inbox reader status and review actions (`src/components/inbox/reader/TransactionImportStatus.tsx`) plus the Settings mapping/run/review workflow (`src/components/settings/cards/EmailTransactionImportCard.tsx` and `src/components/settings/cards/transaction-import/TransactionImportReviewList.tsx`) consume the authenticated transaction-import routes.

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

1. `InboxDesktopPane` sends provider UID plus display metadata through the dedicated email handoff and opens the already-mounted Alfred Panel. Alfred is desktop-only, so mobile exposes neither this action nor the panel; demo surfaces also omit the action.
2. `POST /api/alfred/email-context` fetches the authoritative provider body, converts it to bounded semantic text, preserves quoted/forwarded history and visible footer text, represents omitted image/file content with markers, and fences every email-controlled field as untrusted data.
3. The server stores that snapshot in the bounded owner-scoped in-memory context store and returns only an opaque context ID plus display metadata. No model/provider call occurs.
4. The composer shows a removable pending card and permits drafting while preparation runs; Send remains gated until the handle is ready. A later reader handoff replaces only the pending attachment and preserves the draft and current conversation.
5. Send posts the owner prompt and context ID to `POST /api/alfred/run`. The route claims the handle and `alfred-run.ts` appends the fenced email plus owner prompt as one user turn.
6. `run_end` consumes the handle and leaves an immutable email reference above the sent prompt. Failure releases the handle, marks the attempt failed, and restores the prompt and attachment for retry.

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

**Persistence:** confirmed document BLOB/revision in Turso; current unsaved recovery envelope in device-local IndexedDB; content-addressed media on the private persistent disk; session/camera in localStorage. Legacy note rows, APIs, demo data, and UI do not exist.
