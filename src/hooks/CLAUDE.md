# Hooks Map (router)

Cross-cutting frontend hooks: dashboard data fetching/streaming, snapshot sync, browser interactions (history, media queries, key holds), and notifications. Calendar-specific hooks live in `calendar/` (see `calendar/CLAUDE.md`).

## Sub-maps

- `calendar/` — calendar domain/view state: controller, selection, search, range caching (see `calendar/CLAUDE.md`)

## Files

### Dashboard data
- `useNews.ts` — News tab data fetching: initial load, tab-visibility background refetch, manual refresh (server sweep + reload)
- `useCurrentDashboard.ts` — dashboard state: fetching, polling, SSE streaming, briefing selection
- `currentDashboardModel.ts` — briefing/live data transforms, active-refresh detection
- `dashboardEventRefreshModel.ts` — pure SSE source-to-refresh-scope routing and strongest-scope merge rules
- `useActiveSnapshot.ts` — active snapshot fetch and sync with processing-time polling
- `useAutoRefresh.ts` — 5-minute interval and tab-focus refresh gates

### Browser interactions
- `useBrowserBackDismiss.ts` — dismissal callback on browser back navigation
- `email/useInboxSelectionHistory.ts` — browser history state for inbox selection
- `useIsMobile.ts` — mobile viewport detection
- `useMediaQuery.ts` — reactive media query matching
- `useMotionPresence.ts` — retains closing UI shells for a bounded exit window while callers immediately remove semantics and interaction
- `useWarmImport.ts` — warms a lazy dynamic import on idle after first paint
- `useDismissablePortal.ts` — outside-pointerdown (sparing one `ref` or many `refs`, plus an optional `ignoreSelector` escape hatch) + capture-phase Escape dismissal for body-portal menus/popovers/anchored panels, with optional Tab containment and on-open autofocus. Consumed by `CalendarQuickActionLayer`, `DeadlineQuickActionLayer`, and `shared/pickers/AnchoredFloatingPanel`

### Preferences + notifications
- `useNotifications.ts` — browser notifications for events, bills, important senders
- `useTriageNotificationSounds.ts` — schedules and gates triage notification sounds
- `useUtilityPayLinks.ts` — builds `{scheduleId: url}` pay-link map from settings; refreshes on `ea-settings-changed`
- `settings/useSettingsPage.ts` — settings UI orchestration: tabs, debounced auto-save, sync status

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Related

- `src/lib/triageSoundGate.ts` — dedup gate consumed by `useTriageNotificationSounds.ts`
- `server/routes/dashboard.ts` — SSE stream consumed by `useCurrentDashboard.ts`
