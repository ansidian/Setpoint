# Calendar Modal Map

The calendar modal's structural layer: month grid, day cells with chip stacks and overflow, multi-day span lanes, floating detail panel, and the three-rail shell (search / grid / context). Entry point is `CalendarModalShell`; state arrives from `src/hooks/calendar/` controllers via `buildCalendarModalShellProps.ts`.

## Files

### Shell + header
- `CalendarModalShell.tsx` — three-rail content orchestration (search, calendar, context, floating detail)
- `CalendarModalFrame.tsx` — outer panel, texture, containment, and inner-canvas DOM/style frame shared by the shell content
- `CalendarModalHeader.tsx` — month/year title, view toggle, search, close
- `CalendarJumpToMonth.tsx` — month/year jump picker popover with crossfade transitions
- `CalendarModalTexture.tsx` — decorative noise overlay
- `buildCalendarModalShellProps.ts` — adapter: controller bundles → shell props contract
- `buildContextContent.tsx` — context-rail content router (editor/detail/empty/summary)

### Grid + cells
- `CalendarScrollContainer.tsx` — thin scroll-viewport shell: hosts `useCalendarScrollViewport` + `useEditorCancelOnScroll`, maps the mounted window to `CalendarMonthBlock`s + spacers
- `CalendarMonthBlock.tsx` — one mounted month: derives block state (`calendarMonthBlockModel`), resolves data/preview, renders the headerless `CalendarGrid`
- `calendarMonthBlockModel.ts` — per-block active/cached/full-data/skeleton derivation (pure)
- `CalendarGrid.tsx` — month grid orchestration: cells, overlays, selection handlers, and memoized span-layout calls
- `CalendarGridCells.tsx` — renders day cells, derives per-cell state
- `CalendarCell.tsx` — single day cell: styling, header, weather, drag-drop targets
- `CalendarGridWeekHeader.tsx` — weekday header row
- `CalendarGridLayers.tsx` — overlay compositor: spans, boundaries, inline overflow, skeleton
- `CalendarGridSkeleton.tsx` — initial-load placeholder
- `CalendarSelectedCellFrame.tsx` — selected-cell content wrapper
- `calendarGridUtils.ts` — grid constants, month cell builder, boundary helpers
- `calendarGridCellModel.ts` — per-cell derived state: filtering, overdue/complete status
- `calendarMonthPreviewModel.ts` — preview entries for mounted non-active months, reused while inputs are unchanged

### Chips, stacks, overflow
- `CalendarCellItemChip.tsx` — item chip button rendering over the pure metrics/content presentation model
- `CalendarCellItemChipModel.ts` — chip label compacting, leading-column width estimation, presentation styling, and content-fit projection
- `CalendarCellItemStack.tsx` — visible/hidden item split with layout measurement
- `CalendarCellItemStackModel.ts` — stack height calculation and visibility split
- `calendarCellItemMetrics.ts` — per-tier item capacity for cells
- `CalendarCellOverflowPopover.tsx` — portal shell, focus, positioning, and keyboard navigation for hidden items
- `CalendarCellOverflowItem.tsx` — one overflow item row: selection/modifier selection, context menu, drag payload, metadata, reminders/status, and active styling
- `CalendarCellOverflowPopover.position.ts` — popover viewport clamping from trigger rect
- `CalendarInlineOverflowLayer.tsx` — inline overflow panel when space permits
- `useCalendarGridOverflow.ts` — overflow state machine: popover vs inline, reanchor on scroll

### Spans + boundaries
- `CalendarEventSpanOverlay.tsx` — multi-day events as pinned row-spanning segments
- `calendarEventSpanLayout.ts` — span lane allocation, segment splitting, lane height single-source, and stable pinned-ghost signature projection

### Floating detail
- `CalendarFloatingDetailPanel.tsx` — anchored floating panel shell: Motion portal, caret, frame, editor autofocus/shake
- `useFloatingDetailPlacement.ts` — positioning state machine: measure (ResizeObserver) → reveal gate → side-flip snap + anchored-placement compute/clamp; hosts `useFloatingDetailDrag` (they share `measuredSize`/drag state in a cycle)
- `useFloatingDetailDrag.ts` — pointer-drag mechanics (drag session, rAF-throttled manual position, user-dragged commit) + `rectFromElement` helper
- `calendarFloatingDetailRevealModel.ts` — pure reveal/snap decision rules (`samePlacement`, anchored/render-placement merge, manual/snap/awaiting/instant transition predicates)
- `CalendarFloatingDetailCaret.tsx` — anchored caret triangle pointing back to the source cell
- `CalendarFloatingDetailCloseButton.tsx` — close control shared by detail and editor headers
- `CalendarFloatingDetailContent.tsx` — routes detail/editor for deadlines vs events
- `calendarFloatingDetailPlacement.ts` — anchor placement geometry with viewport clamping and side flip

### Rails
- `CalendarSearchRail.tsx` — left rail: search input, date-grouped results, keyboard nav
- `CalendarSearchRailParts.tsx` — search result rows, date headers, skeletons
- `CalendarModalContextRail.tsx` — right rail container for detail/editor/agenda
- `CalendarModalAgendaRailContent.tsx` — agenda list entry for the right rail
- `AnimatedRailContent.tsx` — motion wrapper for rail content swaps

### Effects
- `useCalendarGridEffects.ts` — wheel month nav, escape/outside overflow close, anchor refresh

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Metrics-driven sizing: chip heights and visible counts adapt to layout tier (uhd/xl/lg/md/sm).
- Components are props-heavy and mostly stateless; derived state comes from the cell/stack models.
- Span lane height/gap constants are single-sourced in `calendarEventSpanLayout.ts` — don't duplicate.
- Calendar focus ring uses `data-calendar-focus-ring="true"`.

## Related

- `src/hooks/calendar/` — controller/selection/search state feeding this layer (see its map)
- `src/components/calendar/views/` — per-domain cell/rail content rendered inside the grid
