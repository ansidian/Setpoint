# Dashboard Map

The landing surface: a Needs-you band, today timeline, and a context column, plus the calendar and notes tabs and overlay mounts. Entry points are `DashboardShell.jsx` (state + overlays + tabs) and `DashboardBody.jsx` (the 3-tier render).

## Files

### Shell + layout
- `DashboardShell.jsx` — orchestrates state and tab switching; mounts the dashboard, inbox, calendar, and notes as four `KeepAliveTab`s
- `DashboardBody.jsx` — renders the three tiers (NeedsYouBand / TodayTimeline / ContextColumn) through `ThreeTierLayout`; resolves live deadlines/bills/events and wires their click-to-open handlers
- `DashboardShellOverlays.jsx` — mounts modal overlays: add task, analytics, customize, command palette, briefing history (no longer the calendar — it is a tab now)
- `InboxMountFallback.jsx` — skeleton fallback shown while the lazy inbox chunk loads on a tab switch
- `KeepAliveTab.jsx` — keep-alive tab wrapper (Activity + freeze-when-hidden) so tab switches don't unmount/remount and a data refresh skips the hidden tab
- `DashboardCalendarModalMount.jsx` — lazy calendar mount (rendered inside the calendar `KeepAliveTab`) with deadline/bill data
- `dashboardShellModel.js` — calendar open-state logic, request builders, hotkey resolution
- `useDashboardShellHotkeys.js` — global shortcuts: command palette, g+d/e chords
- `useCalendarWorkspaceState.js` — calendar workspace state slice: view/focus/overlay deep-link state, `openCalendar`/`changeCalendarView`, and the leave-clear + workspace-change-notify effects
- `useAlfredPanelState.js` — Alfred panel mount/open/new-chat/handoff state and its stable actions
- `useLiveReadOverrides.js` — live read-override map + derived inbox unread-signal count; prunes overrides whose emails left the active snapshot
- `scrollToSection.js` — smooth-scroll to a dashboard `data-sect` target after a tab switch
- `layout/DashboardScenePrimitives.jsx` — motion-wrapped frame, scene regions, and the `ThreeTierLayout` band/timeline/context wiring
- `layout/dashboard-scene-tokens.js` — transition timings and stagger delays

### Tier 1 — Needs-you band
- `needsYou/NeedsYouBand.jsx` — the band: a needs-you count plus the most urgent overdue/due-today/email priority cards
- `needsYou/needsYouModel.js` — classifies deadlines/bills/emails into urgent + backfill cards (overdue/due-today only; bills admit `days===0`)
- `needsYou/NeedsYouCountBlock.jsx` — the leading count + breakdown block
- `needsYou/PriorityCard.jsx` — a single priority card; deadline/bill bodies are click-to-open, emails open via their button

### Tier 2 — Timeline
- `TodayTimeline.jsx` — merges events and deadlines chronologically with live now marker
- `timeline/TimelineClock.jsx` — ticking current-time source for the now marker
- `timeline/TimelineDayGroup.jsx` — day grouping and the spine; injects the focus-window now marker into the today rail
- `timeline/TimelineHeader.jsx` — section title, live clock, and refresh status
- `timeline/TimelineRow.jsx` — event/deadline row; the live row renders the bounded in-card now-marker (NOW H:MM · N% elapsed)
- `timeline/TimelineNowMarker.jsx` — standalone "NOW · H:MM" marker for a focus-window gap (no live event); mutually exclusive with TimelineRow's in-card line
- `timeline/TimelineSkeleton.jsx` — loading placeholders
- `timeline/timeline-helpers.js` — day grouping, layout constants, now-marker progress math (percentElapsed / formatNowMarkerLabel / formatNowMarkerClock), and the focus-window marker slot (resolveTodayNowMarkerIndex)

### Tier 3 — Context column
- `context/ContextColumn.jsx` — the right column: weather, coming-up, and the inbox peek
- `context/WeatherCard.jsx` — weather card that expands on hover/focus/tap to reveal the rest-of-today hourly strip and a next-3-days forecast
- `context/weatherCardModel.js` — pure transforms shaping the live feed into the hover card's hour/day view-models (now-accent, rain chip, condition labels)
- `context/ComingUpCard.jsx` — upcoming (future) deadlines/bills list
- `context/comingUpModel.js` — builds the coming-up rows from live deadlines/bills

### Rails (context-column building blocks)
- `rails/InboxPeek.jsx` — important-email preview with needs-you count (used by `ContextColumn`)
- `rails/railModel.js` — `timeAgo` relative-time formatting for the inbox peek
- `rails/railPrimitives.jsx` — shared `SectionHeader`/`OpenInboxButton`/`EmptyRow` used by the inbox peek and Coming-up card

### Data + details
- `calendarBillsData.js` — transforms live data into calendar-compatible bill shape
- `inboxBadgeModel.js` — unread signal count with read-state overrides
- `DeadlineDetailPopover.jsx` — mobile deadline detail sheet with edit/mark-done
- `MarkDoneAction.jsx` — quiet text-only "Mark done" control shared by the Needs-you band's upcoming cards and the Coming-up rows; reveals on parent hover or its own focus

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- One fixed layout, branched on `isMobile` inside `ThreeTierLayout` (`layout/DashboardScenePrimitives.jsx`): desktop is a no-page-scroll column (band on top, timeline + 344px context column below); mobile stacks the same three tiers. There are no per-user layout modes.
- Overdue/due-today deadlines and due-today bills live only in the Needs-you band (the single home for "open this now"); the context column shows future items. `DashboardBody` passes the band `{ upcoming: deadlines }` because the band model reads the object form.
- Motion uses scene tokens for staggered entry; respect reduced motion.

## Related

- `src/components/notes/` — Notes tab (key `4`): CodeMirror live-markdown editor, search, tags, archive, promote (see its map)
- `src/components/calendar/` — calendar tab mounted via `DashboardCalendarModalMount.jsx`
- `src/components/alfred/` — Alfred Panel mounted by `DashboardShell.jsx` (⌘\ toggle, ⌘⇧\ new chat)
- `server/routes/dashboard.js` — state fetch + SSE stream backing this view
