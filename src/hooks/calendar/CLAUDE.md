# Calendar Hooks Map

Calendar domain and view state: range fetching/caching, modal interaction (selection, search, hotkeys, dismissal), floating detail anchoring, and editor routing. Entry point is `useCalendarModalController.jsx`, which wires the sub-hooks and hands bundles to the modal shell. Pure model files (suffixed `Model`) export stateless logic; hooks own effects and React state.

## Files

### Models (pure)
- `calendarRangeModel.js` — month key arithmetic, range expansion, fetch grouping
- `calendarScrollModel.js` — month index math, navigable radius, settle window, week-row alignment, scroll direction, prefetch range
- `calendarSettleModel.js` — pure scroll-settle decision tree (defer-on-mismatch, settledAway, scroll-driven/align gating, display/label/fetch outputs) extracted from `CalendarScrollContainer`'s settle timer
- `calendarScrollSyncModel.js` — pure decisions for grid↔agenda scroll sync
- `calendarGridRowModel.js` — fixed week-row heights and per-month row layout math
- `agendaFetchModel.js` — agenda month fetch planning: initial months, scroll prefetch
- `agendaScrollModel.js` — agenda scroll math (no runtime consumers yet; covered by its tests)
- `calendarPlanningSessionModel.js` — planning state transitions (idle/loading/slow/degraded)
- `calendarFloatingDetailModel.js` — floating detail predicates, anchor logic, reanchoring rules
- `calendarModalInteractionModel.js` — storage keys, view normalization, deadline-create logic
- `calendarModalSearchModel.js` — search scope, placeholders, coverage checks, result filtering
- `calendarModalSelectionModel.js` — focus date parsing, grid visibility, view sync snapshots
- `calendarControllerHelpers.js` — pure controller helpers (month math, event dedupe, range/overlay matching, item-location/focus resolution, search-result mapping) extracted from `useCalendarModalController.jsx`
- `calendarEntryReadinessModel.js` — entry-readiness projection (events-range loading + agenda-entry-ready gate over committed/seeded/current deadline overlay data) extracted from the `viewData` memo in `useCalendarModalController.jsx`

### Controller + view model
- `useCalendarModalController.jsx` — main orchestrator wiring sub-hooks and editors
- `useCalendarModalViewModel.js` — visible month data and shell prop building
- `useCalendarModalSelection.js` — view date, selected day, focus tracking per open request

### Calendar behavior
- `useCalendarEventSelectionSet.js` — event multi-select + clipboard submachine (selection set, copy/paste, seeded-toggle rules) hosting the event quick-actions bundle so its batch-delete callback prunes the selection; extracted from `useCalendarModalController.jsx`
- `useCalendarSearchActivation.js` — calendar-search activation cluster (search UI hook + result/date-header activation, grid-navigability, anchor resolution) extracted from `useCalendarModalController.jsx`; must be called after the view model (reads `computed`)
- `useCalendarModalSearch.js` — search UI state, debounced API calls, highlighting
- `useCalendarModalHotkeys.js` — arrow nav, month pagination, Escape for the inner cascade (overflow/detail/editor), and the 3 key re-pressed in calendar toggles events/bills (1/2/4 bubble to the shell tab switcher); the calendar is a shell tab now, so Escape no longer closes a surface

### Floating detail + editor routing
- `useCalendarFloatingDetail.js` — floating detail anchoring, session memory, placement
- `useFloatingEditorRouting.js` — unified deadline/event editor routing, save→detail transitions
- `useCalendarModalEditorRouting.js` — backward-compat re-export wrapper

### Domain state + lifecycle
- `useCalendarRange.js` — per-month event caching/fetching, prefetch radius, staleness
- `useCalendarDomainRange.js` — deadline/bill prefetch planning from visible bounds
- `useAgendaFetch.js` — agenda month fetching: initial mount fetch, scroll-driven prefetch
- `useCalendarScrollSync.js` — grid↔agenda scroll orchestration: settle-driven sync, navigation commands
- `useCalendarScrollViewport.js` — the infinite multi-month scroll state machine (user-vs-programmatic refs, settle lifecycle via `calendarSettleModel`, mount centering, rAF scroll handler, prop-driven nav/crossfade) extracted from `CalendarScrollContainer`; returns `{containerRef, refYear, refMonth, wFirst, wLast, getHeight}`
- `useEditorCancelOnScroll.js` — clean-floating-editor cancel-on-owner-scroll latch; exposes `maybeCancelEditorOnScroll(programmaticNavActive)` consumed by the scroll handler
- `useStaleDomainCache.js` — generic TTL-gated cache wrapper for domain fetches
- `useDeadlineOverlayState.js` — overlay visibility triad with persistence
- `usePlanningReadinessState.js` — planning state machine, deadline fetch orchestration
- `useCalendarDeadlineOverlay.js` — wraps planning readiness + derives the identity-stable deadline-overlay object and per-settle committed record (extracted from `useCalendarModalController.jsx`)
- `useAgendaSyncPolicy.js` — passive sync suppression window, grid-owned selection gate

### Utilities
- `useDashboardFocusRetry.js` — polling/backoff retry for dashboard-detail focus attach
- `useDashboardDetailFocus.js` — dashboard-detail focus-retry machine (pending-request derivation + attach attempt + retry wiring) extracted from `useCalendarModalController.jsx`
- `useViewportWidth.js` — RAF-debounced viewport width listener

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Calendar hooks/models live here, UI in `src/components/calendar/` — do not add calendar files elsewhere.
- Model files are pure and unit-tested directly; hooks consume them and own side effects.

## Related

- `src/components/calendar/modal/` — shell consuming these bundles (see its map)
- `src/components/calendar/events/` — editor invoked via `useFloatingEditorRouting.js`
