# Dashboard Map

The landing surface: hero (greeting/callouts/weather), today timeline, and rails (bills/deadlines/inbox peek), plus the calendar and notes tabs and overlay mounts. Entry points are `DashboardShell.jsx` (state + overlays + tabs) and `DashboardBody.jsx` (layout resolution and section rendering).

## Files

### Shell + layout
- `DashboardShell.jsx` — orchestrates state and tab switching; mounts the dashboard, inbox, calendar, and notes as four `KeepAliveTab`s
- `DashboardBody.jsx` — resolves layout mode, renders hero/timeline/rails sections
- `DashboardShellOverlays.jsx` — mounts modal overlays: add task, analytics, customize, command palette, briefing history (no longer the calendar — it is a tab now)
- `InboxMountFallback.jsx` — skeleton fallback shown while the lazy inbox chunk loads on a tab switch
- `KeepAliveTab.jsx` — keep-alive tab wrapper (Activity + freeze-when-hidden) so tab switches don't unmount/remount and a data refresh skips the hidden tab
- `DashboardCalendarModalMount.jsx` — lazy calendar mount (rendered inside the calendar `KeepAliveTab`) with deadline/bill data
- `dashboardShellModel.js` — calendar open-state logic, request builders, hotkey resolution
- `dashboardBodyLayoutModel.js` — layout mode (focus/paper/mobile) and section ordering
- `useDashboardShellHotkeys.js` — global shortcuts: command palette, g+d/e chords
- `layout/DashboardScenePrimitives.jsx` — motion-wrapped frame and scene regions
- `layout/dashboard-scene-tokens.js` — transition timings and stagger delays

### Hero
- `DashboardHero.jsx` — hero section entry: callouts and quick actions
- `hero/HeroMessageBlock.jsx` — greeting, current time, day summary
- `hero/HeroCalloutCard.jsx` — urgent next event/deadline/bill cards with urgency coloring
- `hero/HeroContextRail.jsx` — weather and focus-window sidebar
- `hero/HeroFocusCard.jsx` — daily focus windows and open-day summary
- `hero/dashboard-hero-helpers.js` — callout card builders, weather icon mapping

### Timeline
- `TodayTimeline.jsx` — merges events and deadlines chronologically with live now marker
- `timeline/TimelineDayGroup.jsx` — day grouping and now-marker positioning
- `timeline/TimelineHeader.jsx` — section title and refresh status
- `timeline/TimelineRow.jsx` — event/deadline row with duration/reminder display
- `timeline/TimelineNowMarker.jsx` — animated current-time indicator
- `timeline/TimelineSkeleton.jsx` — loading placeholders
- `timeline/timeline-helpers.js` — day grouping, layout constants, marker math

### Rails
- `rails/Rails.jsx` — rail component aggregator
- `rails/BillsRail.jsx` — upcoming payments with due date and amount urgency
- `rails/DeadlinesRail.jsx` — tasks grouped by priority with status icons
- `rails/InboxPeek.jsx` — important-email preview with needs-you count
- `rails/railModel.js` — priority palette and time-ago formatting
- `rails/railPrimitives.jsx` — shared rail headers, urgency pills, badges

### Data + details
- `calendarBillsData.js` — transforms live data into calendar-compatible bill shape
- `inboxBadgeModel.js` — unread signal count with read-state overrides
- `DeadlineDetailPopover.jsx` — mobile deadline detail sheet with edit/mark-done

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Layout modes (focus/paper/mobile) are resolved once in `dashboardBodyLayoutModel.js`; sections render mode-agnostically.
- Motion uses scene tokens for staggered entry; respect reduced motion.

## Related

- `src/components/calendar/` — calendar tab mounted via `DashboardCalendarModalMount.jsx`
- `src/components/alfred/` — Alfred Panel mounted by `DashboardShell.jsx` (⌘\ toggle, ⌘⇧\ new chat)
- `server/routes/dashboard.js` — state fetch + SSE stream backing this view
