# Dashboard Map

The landing surface: a Needs-you band, today timeline, and a context column, plus the calendar and notes tabs and overlay mounts. Entry points are `DashboardShell.tsx` (state + overlays + tabs) and `DashboardBody.tsx` (the 3-tier render).

## Files

### Shell + layout
- `DashboardShell.tsx` — orchestrates state and tab switching; mounts dashboard, inbox, calendar, notes, and news through `DashboardTabPanel`
- `DashboardTabPanel.tsx` — dashboard-specific tab seam combining keep-alive/freeze behavior with the responsive `tabpanel` ID and accessible name contract
- `DashboardBody.tsx` — renders the three tiers (NeedsYouBand / TodayTimeline / ContextColumn) through `ThreeTierLayout`; resolves live deadlines/bills/events and wires their click-to-open handlers
- `DashboardShellOverlays.tsx` — mounts modal overlays: add task, analytics, customize, command palette, briefing history (no longer the calendar — it is a tab now)
- `InboxMountFallback.tsx` — skeleton fallback shown while the lazy inbox chunk loads on a tab switch
- `KeepAliveTab.tsx` — keep-alive tab wrapper (Activity + freeze-when-hidden) so tab switches don't unmount/remount and a data refresh skips the hidden tab
- `DashboardCalendarModalMount.tsx` — lazy calendar mount (rendered inside the calendar `KeepAliveTab`) with deadline/bill data
- `dashboardShellModel.ts` — calendar open-state logic, request builders, hotkey resolution, and the pure glance-sheet tap toggle (`nextItemSheet`: re-tap closes, keyed per kind)
- `useDashboardShellHotkeys.ts` — global shortcuts: command palette, g+d/e chords
- `useCalendarWorkspaceState.ts` — calendar workspace state slice: view/focus/overlay deep-link state, `openCalendar`/`changeCalendarView`, and the leave-clear + workspace-change-notify effects
- `useDashboardItemSheet.ts` — dashboard glance-sheet selection/toggle state, tab-leave cleanup, direct item routing, and kind-aware "Open in calendar" handoff
- `useMobileDashboardScrollRestoration.ts` — captures the mobile dashboard's shared-scroll offset and restores it immediately plus on the next frame after returning to the tab
- `useAlfredPanelState.ts` — Alfred panel mount/open/new-chat/handoff state and its stable actions
- `useLiveReadOverrides.ts` — live read-override map + derived inbox unread-signal count; prunes overrides whose emails left the active snapshot
- `scrollToSection.ts` — smooth-scroll to a dashboard `data-sect` target after a tab switch
- `layout/DashboardScenePrimitives.tsx` — motion-wrapped frame, scene regions, and the `ThreeTierLayout` band/timeline/context wiring
- `layout/dashboard-scene-tokens.ts` — transition timings and stagger delays

### Tier 1 — Needs-you band
- `needsYou/NeedsYouBand.tsx` — the band: a needs-you count plus every overdue/due-today/email priority card; desktop switches to a wheel-scroll horizontal rail above five cards
- `needsYou/needsYouModel.ts` — classifies deadlines/bills/emails into urgent cards plus up to two quiet upcoming backfill cards (overdue/due-today only; bills admit `days===0`)
- `needsYou/NeedsYouCountBlock.tsx` — the leading count + breakdown block
- `needsYou/PriorityCard.tsx` — a single priority card; deadline/bill bodies are click-to-open, emails open via their button
- `needsYou/NeedsYouCarousel.tsx` — mobile-only horizontal scroll-snap carousel of every priority/backfill card (full-width count header, fixed-width peeking slides, position dots); `NeedsYouBand` renders it instead of the desktop row on phones

### Tier 2 — Timeline
- `TodayTimeline.tsx` — merges events and deadlines chronologically with live now marker
- `timeline/TimelineClock.tsx` — ticking current-time source for the now marker
- `timeline/TimelineDayGroup.tsx` — day grouping and the spine; injects the focus-window now marker into the today rail
- `timeline/TimelineHeader.tsx` — section title, live clock, and refresh status
- `timeline/TimelineRow.tsx` — event/deadline row; the live row renders the bounded in-card now-marker (NOW H:MM · N% elapsed)
- `timeline/TimelineNowMarker.tsx` — standalone "NOW · H:MM" marker for a focus-window gap (no live event); mutually exclusive with TimelineRow's in-card line
- `timeline/TimelineSkeleton.tsx` — loading placeholders
- `timeline/timeline-helpers.ts` — day grouping, layout constants, now-marker progress math (percentElapsed / formatNowMarkerLabel / formatNowMarkerClock), and the focus-window marker slot (resolveTodayNowMarkerIndex)

### Tier 3 — Context column
- `context/ContextColumn.tsx` — the right column: weather, coming-up, and the inbox peek
- `context/WeatherCard.tsx` — weather card that expands on hover/focus/tap to reveal the rest-of-today hourly strip and a next-3-days forecast
- `context/weatherCardModel.ts` — pure transforms shaping the live feed into the hover card's hour/day view-models (now-accent, rain chip, condition labels)
- `context/ComingUpCard.tsx` — upcoming (future) deadlines/bills list
- `context/comingUpModel.ts` — builds the coming-up rows from live deadlines/bills

### Rails (context-column building blocks)
- `rails/InboxPeek.tsx` — important-email preview with needs-you count (used by `ContextColumn`)
- `rails/railModel.ts` — `timeAgo` relative-time formatting for the inbox peek
- `rails/railPrimitives.tsx` — shared `SectionHeader`/`OpenInboxButton`/`EmptyRow` used by the inbox peek and Coming-up card

### Data + details
- `calendarBillsData.ts` — transforms live data into calendar-compatible bill shape
- `inboxBadgeModel.ts` — unread signal count with read-state overrides
- `DashboardItemDetailSheet.tsx` — unified glance sheet for a dashboard item tap (deadline/bill/event): full detail via the reused calendar cards (`DeadlineDetailCard`/`BillSelectedCard`/`EventSelectedCard`) + per-type action + "Open in calendar" deep-link; anchored panel on desktop, bottom sheet on mobile (via `AnchoredFloatingPanel`). Carries the deadline inline edit (`AddTaskPanel`) + mark-complete. Replaces the old DeadlineDetailPopover + CalendarItemDetailSheet
- `glanceActionsModel.ts` — pure per-type action descriptors for the glance sheet (deadline: complete/edit/todoist; bill: actual/pay; event: zoom/url/gcal; all: open-in-calendar)
- `MarkDoneAction.tsx` — quiet text-only "Mark done" control shared by the Needs-you band's upcoming cards and the Coming-up rows; reveals on parent hover or its own focus

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- One fixed layout, branched on `isMobile` inside `ThreeTierLayout` (`layout/DashboardScenePrimitives.tsx`): desktop is a no-page-scroll column (band on top, timeline + 344px context column below); mobile stacks the same three tiers. There are no per-user layout modes.
- Overdue/due-today deadlines and due-today bills live only in the Needs-you band (the single home for "open this now"); the context column shows future items. `DashboardBody` passes the band `{ upcoming: deadlines }` because the band model reads the object form.
- Motion uses scene tokens for staggered entry; respect reduced motion.

## Related

- `src/components/notes/` — Notes tab (key `4`): CodeMirror live-markdown editor, search, tags, archive, promote (see its map)
- `src/components/calendar/` — calendar tab mounted via `DashboardCalendarModalMount.tsx`
- `src/components/alfred/` — Alfred Panel mounted by `DashboardShell.tsx` (⌘\ toggle, ⌘⇧\ new chat)
- `server/routes/dashboard.ts` — state fetch + SSE stream backing this view
