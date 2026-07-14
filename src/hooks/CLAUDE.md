# Hooks Map (router)

Cross-cutting frontend hooks: dashboard data fetching/streaming, snapshot sync, browser interactions (history, media queries, key holds), and notifications. Calendar-specific hooks live in `calendar/` (see `calendar/CLAUDE.md`).

## Sub-maps

- `calendar/` — calendar domain/view state: controller, selection, search, range caching (see `calendar/CLAUDE.md`)

## Files

### Dashboard data
- `useNews.js` — News tab data fetching: initial load, tab-visibility background refetch, manual refresh (server sweep + reload)
- `useCurrentDashboard.js` — dashboard state: fetching, polling, SSE streaming, briefing selection
- `currentDashboardModel.js` — briefing/live data transforms, active-refresh detection
- `dashboardEventRefreshModel.js` — pure SSE source-to-refresh-scope routing and strongest-scope merge rules
- `useActiveSnapshot.js` — active snapshot fetch and sync with processing-time polling
- `useAutoRefresh.js` — 5-minute interval and tab-focus refresh gates

### Browser interactions
- `useBrowserBackDismiss.js` — dismissal callback on browser back navigation
- `email/useInboxSelectionHistory.js` — browser history state for inbox selection
- `useIsMobile.js` — mobile viewport detection
- `useMediaQuery.js` — reactive media query matching
- `useKeyHold.js` — key hold duration/progress with completion callback
- `useWarmImport.js` — warms a lazy dynamic import on idle after first paint
- `useDismissablePortal.js` — outside-pointerdown (sparing one `ref` or many `refs`, plus an optional `ignoreSelector` escape hatch) + capture-phase Escape dismissal for body-portal menus/popovers/anchored panels, with optional Tab containment and on-open autofocus. Consumed by `CalendarQuickActionLayer`, `DeadlineQuickActionLayer`, and `shared/pickers/AnchoredFloatingPanel`

### Preferences + notifications
- `useNotifications.js` — browser notifications for events, bills, important senders
- `useTriageNotificationSounds.js` — schedules and gates triage notification sounds
- `useUtilityPayLinks.js` — builds `{scheduleId: url}` pay-link map from settings; refreshes on `ea-settings-changed`
- `settings/useSettingsPage.js` — settings UI orchestration: tabs, debounced auto-save, sync status

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Related

- `src/lib/triageSoundGate.js` — dedup gate consumed by `useTriageNotificationSounds.js`
- `server/routes/dashboard.js` — SSE stream consumed by `useCurrentDashboard.js`
