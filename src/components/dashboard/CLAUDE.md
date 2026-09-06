# Dashboard Map

The landing surface: a Needs-you band, today timeline, and a context column, plus the calendar and notes tabs and overlay mounts. Entry points are `DashboardShell.tsx` (state + overlays + tabs) and `DashboardBody.tsx` (the 3-tier render).

## Files

- `CompletionTransition.tsx` — shared Done receipt: departure for Needs You and Coming Up, in-place feedback for Today before its completed row dims; completing/departing controls are inert and reduced motion is immediate.

### Shell + layout
- `DashboardShell.tsx` — orchestrates state and tab switching; supplies mobile Inbox app actions while hiding its redundant shell header; mobile Dashboard uses a compact date/title header with shared app actions; mounts dashboard, inbox, calendar, notes, and news through `DashboardTabPanel`; routes Alfred proposal review into the typed Calendar bridge without pre-closing the panel
- `DashboardTabPanel.tsx` — dashboard-specific tab seam combining keep-alive/freeze behavior with the responsive `tabpanel` ID and accessible name contract
- `DashboardBody.tsx` — renders NeedsYouBand / TodayTimeline with financial context / ContextColumn through `ThreeTierLayout`; resolves live deadlines/bills/events and wires their click-to-open handlers
- `dashboard-interactions.css` — shared lift/press feedback for primary dashboard item triggers; Inbox Peek intentionally does not opt in
- `DashboardShellOverlays.tsx` — mounts modal overlays: add task, analytics, customize, command palette, briefing history (no longer the calendar — it is a tab now)
- `InboxMountFallback.tsx` — skeleton fallback shown while the lazy inbox chunk loads on a tab switch
- `KeepAliveTab.tsx` — keep-alive tab wrapper (Activity + freeze-when-hidden) so tab switches don't unmount/remount and a data refresh skips the hidden tab
- `DashboardCalendarModalMount.tsx` — lazy calendar mount (rendered inside the calendar `KeepAliveTab`) with deadline/bill data plus the optional one-shot event create request
- `dashboardShellModel.ts` — calendar open-state logic, typed event-create request routing, request builders, hotkey resolution, and the pure glance-sheet tap toggle (`nextItemSheet`: re-tap closes, keyed per kind)
- `useDashboardShellHotkeys.ts` — global shortcuts: command palette, g+d/e chords
- `useCalendarWorkspaceState.ts` — calendar workspace state slice: view/focus/overlay deep-link state, one-shot typed event-create request ownership/acknowledgement consumption, `openCalendar`/`changeCalendarView`, and the leave-clear + workspace-change-notify effects
- `useDashboardItemSheet.ts` — dashboard glance-sheet selection/toggle state, tab-leave cleanup, direct item routing, and kind-aware "Open in calendar" handoff
- `useMobileInboxNavigation.ts` — owns mobile email origin/history: Dashboard opens return directly home, list opens return to Inbox, overlays dismiss first
- `useMobileDashboardScrollRestoration.ts` — captures the mobile dashboard's shared-scroll offset and restores it immediately plus on the next frame after returning to the tab
- `useSnapshotNavigation.ts` — loads ordered snapshot history while Inbox is active, resolves adjacent frozen/current transitions, and cancels pending navigation when returning directly to Current
- `snapshotNavigationModel.ts` — pure older/newer adjacency resolver over newest-first snapshot history
- `AlfredWorkspaceContext.tsx` — shares desktop Alfred open/close state and the Inbox dock measurement target; the shell keeps the conversation mounted across tabs.
- `useAlfredPanelState.ts` — Alfred panel mount/open/new-chat/handoff and Inbox placement state and its stable actions
- `useLiveReadOverrides.ts` — live read-override map + derived inbox unread-signal count; prunes overrides whose emails left the active snapshot
- `layout/DashboardScenePrimitives.tsx` — motion-wrapped frame, scene regions, and the `ThreeTierLayout` band/timeline/context wiring
- `layout/dashboard-scene-tokens.ts` — transition timings and stagger delays

### Tier 1 — Needs-you band
- `needsYou/NeedsYouBand.tsx` — the band: a needs-you count with expandable urgent rows on mobile and priority cards on desktop; desktop switches to a wheel-scroll horizontal rail above five cards
- `needsYou/needsYouModel.ts` — classifies deadlines/bills/emails into urgent cards (dashboard disables future backfill; bills admit `days===0`), with snapshot identity deduplication
- `needsYou/NeedsYouCountBlock.tsx` — the leading count + breakdown block
- `needsYou/StartHereStrip.tsx` / `needsYou/StartHereStrip.css` — compact ranked recommendation command that reuses the first urgent card and routes through its existing open behavior
- `needsYou/PriorityCard.tsx` — a single priority card; deadline/bill bodies are click-to-open, emails open via their button
- `needsYou/MobileNeedsYouList.tsx` / `needsYou/MobileNeedsYouList.css` — compact mobile count/breakdown and first three urgent rows, expandable to all, with separate open and completion actions

### Tier 2 — Timeline
- `TodayTimeline.tsx` — merges events and deadlines chronologically with live now marker
- `timeline/TimelineClock.tsx` — ticking current-time source for the now marker
- `timeline/TimelineDayGroup.tsx` — day grouping and the spine; injects the focus-window now marker into the today rail
- `timeline/TimelineHeader.tsx` / `timeline/timeline-presentation.css` — compact title, live clock, filter controls, refresh status and shared timeline presentation
- `timeline/MobileTodayTimeline.tsx` / `timeline/timeline-mobile.css` — mobile primary timeline and Earlier today disclosure for ended timed events; touch targets and row states
- `timeline/TimelineRow.tsx` — event/deadline row; legibly dimmed past events/completed deadlines and explicit Completed/overdue badges, including Needs You reference rows; the live row renders a thin progress track and fixed readable elapsed label (NOW H:MM · N% elapsed)
- `timeline/TimelineNowMarker.tsx` — standalone "NOW · H:MM" marker for a focus-window gap (no live event); mutually exclusive with TimelineRow's in-card line
- `timeline/TimelineSkeleton.tsx` — loading placeholders
- `timeline/timeline-helpers.ts` — day grouping, layout constants, now-marker progress math (percentElapsed / formatNowMarkerLabel / formatNowMarkerClock), and the focus-window marker slot (resolveTodayNowMarkerIndex)

### Tier 3 — Context column
- `context/ContextColumn.tsx` — the right column: weather, Ahead, and Inbox Peek; occurrence-qualified deadline actions
- `context/WeatherCard.tsx` — weather card that expands on hover/focus/tap to reveal the rest-of-today hourly strip and a next-3-days forecast
- `context/weatherCardModel.ts` — pure transforms shaping the live feed into the hover card's hour/day view-models (now-accent, rain chip, condition labels)
- `context/ComingUpCard.tsx` — Ahead: future deadlines grouped by day, bounded preview with day/week disclosures
- `context/MobileComingUp.css` — mobile upcoming-row layout, completion/open controls, and preview disclosure states
- `context/comingUpModel.ts` — builds the coming-up rows from live deadlines/bills; mobile excludes today through includeToday

### Rails (context-column building blocks)
- `rails/InboxPeek.tsx` — full snapshot lane counts and three useful summaries excluding urgent-band emails; filtered Inbox handoffs
- `rails/railModel.ts` — `timeAgo` relative-time formatting for the inbox peek
- `rails/railPrimitives.tsx` — shared `SectionHeader`/`EmptyRow` used by the inbox peek and Coming-up card

### Financial context and schedule notices
- `finance/DashboardFinance.tsx` — Money Ahead / Spending Snapshot pair and Finance Review / Recent Automation activity with Settings and Calendar handoffs
- `finance/useDashboardFinance.ts` — independent local financial read, refresh/focus handling, and last-success retention
- `finance/MoneyAheadCard.tsx` — future unpaid scheduled bills, seven-day total and bounded expandable rows
- `finance/SpendingSnapshotCard.tsx` — month-to-date comparison, matching prior dates, top categories and sync freshness
- `finance/FinancialActivityCard.tsx` — pending review count and latest automatic outcomes with review and source actions
- `finance/FinancialEmailPreview.tsx` — anchored/mobile source preview through the existing safe email body reader
- `finance/finance-cards.css` — financial grid, typography, controls and responsive/motion states
- `timeline/DashboardScheduleNotices.tsx` / `.css` — conditional stored departure estimate and overlap notices, reusing calendar reminders
- `timeline/dashboardScheduleModel.ts` — exact occurrence reminder matching and remaining-today overlap policy
- `rails/inboxPeekModel.ts` / `rails/InboxPeek.css` — snapshot deduplication, lane counts, bounded selection and compact presentation

### Data + details
- `calendarBillsData.ts` — transforms live data into calendar-compatible bill shape
- `dashboardCalendarModalModel.ts` — pure deadline projection for seeding the calendar workspace from current dashboard data
- `inboxBadgeModel.ts` — unread signal count with read-state overrides
- `DashboardItemDetailSheet.tsx` — unified glance sheet for a dashboard item tap (deadline/bill/event): full detail via the reused calendar cards (`DeadlineDetailCard`/`BillSelectedCard`/`EventSelectedCard`) + per-type action + "Open in calendar" deep-link; anchored panel on desktop, bottom sheet on mobile (via `AnchoredFloatingPanel`). Carries the deadline inline edit (`AddTaskPanel`) + mark-complete. Replaces the old DeadlineDetailPopover + CalendarItemDetailSheet
- `glanceActionsModel.ts` — pure per-type action descriptors for the glance sheet (deadline: complete/edit/todoist; bill: actual/pay; event: zoom/url/gcal; all: open-in-calendar)
- `MarkDoneAction.tsx` — quiet text-only "Mark done" control shared by the Needs-you band's upcoming cards and the Coming-up rows; reveals on parent hover or its own focus

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- One fixed layout, branched on `isMobile` inside `ThreeTierLayout` (`layout/DashboardScenePrimitives.tsx`): desktop is a no-page-scroll column (band on top, scrolling Today/finance stack + 344px scrolling context column below); mobile stacks the same three tiers. There are no per-user layout modes.
- Overdue/due-today deadlines and due-today bills live only in the Needs-you band (the single home for "open this now"); Ahead shows future deadlines and Money Ahead shows future bills. Today retains deadline context but future deadlines do not repeat in its later groups. `DashboardBody` passes the band `{ upcoming: deadlines }` because the band model reads the object form.
- Motion uses scene tokens for staggered entry; respect reduced motion.

## Related

- `src/components/notes/` — desktop-only Notes tab (key `4`): licensed tldraw canvas with refresh-based cross-device persistence (see its map)
- `src/components/calendar/` — calendar tab mounted via `DashboardCalendarModalMount.tsx`
- `src/components/alfred/` — desktop-only Alfred Panel mounted by `DashboardShell.tsx` (⌘\ toggle, ⌘⇧\ new chat); mobile neither mounts nor exposes it
- `server/routes/dashboard.ts` — state fetch + SSE stream backing this view
