# Calendar Hooks Map

Calendar domain and view state: range fetching/caching, modal interaction (selection, search, hotkeys, dismissal), floating detail anchoring, and editor routing. Entry point is `useCalendarModalController.tsx`, which wires the sub-hooks and hands bundles to the modal shell. Pure model files (suffixed `Model`) export stateless logic; hooks own effects and React state.

## Files

### Models (pure)
- `calendarRangeModel.ts` — month key arithmetic, range expansion, fetch grouping
- `calendarScrollModel.ts` — month index/target-clamp math, navigable radius, settle window, week-row alignment, scroll direction, prefetch range
- `calendarSettleModel.ts` — pure scroll-settle decision tree (defer-on-mismatch, settledAway, scroll-driven/align gating, display/label/fetch outputs) extracted from `CalendarScrollContainer`'s settle timer
- `calendarScrollSyncModel.ts` — pure decisions for grid↔agenda scroll sync
- `calendarGridRowModel.ts` — fixed week-row heights and per-month row layout math
- `agendaFetchModel.ts` — agenda month fetch planning: initial months, scroll prefetch
- `calendarPlanningSessionModel.ts` — planning state transitions (idle/loading/slow/degraded)
- `calendarFloatingDetailModel.ts` — floating detail predicates, anchor logic, reanchoring rules
- `calendarModalInteractionModel.ts` — storage keys, view normalization, deadline-create logic
- `calendarModalSearchModel.ts` — search scope, placeholders, coverage checks, result filtering
- `calendarModalSelectionModel.ts` — focus date parsing, grid visibility, view sync snapshots
- `calendarControllerHelpers.ts` — pure controller helpers (month math, event dedupe, range/overlay matching, item-location/focus resolution, search-result mapping) extracted from `useCalendarModalController.tsx`
- `calendarEntryReadinessModel.ts` — entry-readiness projection (events-range loading + agenda-entry-ready gate over committed/seeded/current deadline overlay data) extracted from the `viewData` memo in `useCalendarModalController.tsx`
- `calendarBillsViewDataModel.ts` — pure bills view-data precedence/status projection: visible range data, broad schedules, pay links, loading/pending/error metadata

### Controller + view model
- `calendarShellLoaders.tsx` — production lazy boundaries for the desktop shell and mobile agenda; Vitest resolves the same module paths eagerly to preserve synchronous behavior-test contracts
- `useCalendarModalController.tsx` — main orchestrator wiring sub-hooks and editors
- `useCalendarModalViewModel.ts` — visible month data and shell prop building
- `useCalendarModalSelection.ts` — view date, selected day, focus tracking per open request
- `useCalendarMonthNavigation.ts` — grouped month commands and grid scroll coordination: clamp targets, editor-aware cleanup, direction/idle tracking, label crossing, and fetch settle

### Calendar behavior
- `useCalendarEventSelectionSet.ts` — event multi-select + clipboard submachine (selection set, copy/paste, seeded-toggle rules) hosting the event quick-actions bundle so its batch-delete callback prunes the selection; extracted from `useCalendarModalController.tsx`
- `useCalendarSearchActivation.ts` — calendar-search activation cluster (search UI hook + result/date-header activation, grid-navigability, anchor resolution) extracted from `useCalendarModalController.tsx`; must be called after the view model (reads `computed`)
- `useCalendarModalSearch.ts` — search UI state, debounced API calls, highlighting
- `useCalendarModalHotkeys.ts` — arrow nav, month pagination, Escape for the inner cascade (overflow/detail/editor), and the 3 key re-pressed in calendar toggles events/bills (1/2/4/5 bubble to the shell tab switcher); the calendar is a shell tab now, so Escape no longer closes a surface. Suspension ladder for `data-suspend-calendar-hotkeys`: `"true"` (target-based, mid-handler), `"all"` (target-based, pre-branch — Alfred), `"blocking"` (presence-based, pre-branch — Analytics/History/CommandPalette overlays, independent of where focus sits)

### Floating detail + editor routing
- `useCalendarFloatingDetail.ts` — floating detail anchoring, session memory, placement
- `useFloatingEditorRouting.ts` — unified deadline/event editor routing, save→detail transitions

### Domain state + lifecycle
- `useCalendarRange.ts` — per-month event caching/fetching, prefetch radius, staleness
- `useCalendarDomainRange.ts` — deadline/bill prefetch planning from visible bounds
- `useAgendaFetch.ts` — agenda month fetching: initial mount fetch, scroll-driven prefetch
- `useCalendarScrollSync.ts` — grid↔agenda scroll orchestration: settle-driven sync, navigation commands
- `useCalendarScrollViewport.ts` — the infinite multi-month scroll state machine (user-vs-programmatic refs, settle lifecycle via `calendarSettleModel`, mount centering, rAF scroll handler, prop-driven nav/crossfade) extracted from `CalendarScrollContainer`; returns `{containerRef, refYear, refMonth, wFirst, wLast, getHeight}`
- `useEditorCancelOnScroll.ts` — clean-floating-editor cancel-on-owner-scroll latch; exposes `maybeCancelEditorOnScroll(programmaticNavActive)` consumed by the scroll handler
- `useStaleDomainCache.ts` — generic TTL-gated cache wrapper for domain fetches
- `useDeadlineOverlayState.ts` — overlay visibility triad with persistence
- `usePlanningReadinessState.ts` — planning state machine, deadline fetch orchestration
- `useCalendarDeadlineOverlay.ts` — wraps planning readiness + derives the identity-stable deadline-overlay object and per-settle committed record (extracted from `useCalendarModalController.tsx`)
- `useAgendaSyncPolicy.ts` — passive sync suppression window, grid-owned selection gate

### Utilities
- `useDashboardFocusRetry.ts` — polling/backoff retry for dashboard-detail focus attach
- `useDashboardDetailFocus.ts` — dashboard-detail focus-retry machine (pending-request derivation + attach attempt + retry wiring) extracted from `useCalendarModalController.tsx`
- `useViewportWidth.ts` — RAF-debounced viewport width listener

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- Calendar hooks/models live here, UI in `src/components/calendar/` — do not add calendar files elsewhere.
- Model files are pure and unit-tested directly; hooks consume them and own side effects.

## Related

- `src/components/calendar/modal/` — shell consuming these bundles (see its map)
- `src/components/calendar/events/` — editor invoked via `useFloatingEditorRouting.ts`
