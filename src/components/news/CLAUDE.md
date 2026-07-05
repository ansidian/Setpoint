# News Map

The News tab: a fifth shell tab, topic-sectioned RSS/HN headline river with a
seen-marker divider and an in-tab source manager. Entry point is `NewsTab.jsx`
(mounted as a lazy `KeepAliveTab` by `DashboardShell`, first-visit-gated like
calendar since it triggers a real fetch on mount). Desktop-only in v1.

## Files

### Tab + reading surface
- `NewsTab.jsx` — owns `useNews`, the held seen-divider marker (adjusted
  during render on a `news` identity change — not an effect, to satisfy the
  repo's ref/set-state-in-effect lint rules), the manage-panel open state, and
  the seen-marker bump-on-leave/pagehide lifecycle
- `NewsView.jsx` — header (title, "updated Xm ago", refresh, Manage) + topic
  sections flowing through CSS multi-columns (`columnWidth` newspaper layout,
  reading order top-to-bottom per column); loading skeleton (static bars, no
  spinner), error/first-run empty states
- `NewsTopicSection.jsx` — one topic: uppercase label header with a
  "{n} new" accent pill and hairline rule, a lead story (newest fresh item,
  or newest item at all when quiet), compact fresh rows, the seen divider
  (only when both fresh and visible-older are non-empty), then older rows
  capped at 8 (5 total when quiet, header dimmed); no-items topics show
  "No stories yet"; `breakInside: avoid` keeps a topic in one column
- `NewsItemRow.jsx` — one headline; the whole row is the link
  (`target="_blank"`), hover/focus styling via `.news-row` in `index.css`
  (row tint + title→accent). Title wraps and clamps at 2 lines (never
  one-line truncated). `variant="lead"` adds a 2-line excerpt (filtered by
  `displayExcerpt` — hnrss "Article URL:" boilerplate suppressed) and the
  feed thumbnail (68px, `referrerPolicy="no-referrer"`, hidden on error).
  Meta line: favicon (DuckDuckGo icon service, hidden on error) + source +
  relative time

### Manage panel
- `NewsManagePanel.jsx` — right-side slide-over (`createPortal` to
  `document.body`, `useDismissablePortal`) with a backdrop scrim and 200ms
  slide-in (`newsPanelIn`/`newsBackdropIn` keyframes in `index.css`; the
  global reduced-motion reset neutralizes both): topic
  create/rename/reorder/delete
  (inline "Confirm?" second click, no modal), per-source enable toggle +
  health badge + delete, HN `minPoints` inline edit, mounts
  `NewsCatalogPicker` when the owner has zero topics
- `NewsAddSourceForm.jsx` — paste-URL → `previewNewsSource` → confirm
  (`createNewsSource`), with an "HN keyword" mode toggle for query + points
- `NewsCatalogPicker.jsx` — starter-bundle checkboxes (topic name + source
  count) → `importNewsStarterTopics`; also the first-run empty-state body
- `manageUi.jsx` — shared `ManageButton` (150ms hover/focus motion, matches
  every other enabled control here)
- `manageStyles.js` — shared `manageInputStyle`; split out of `manageUi.jsx`
  because `react-refresh/only-export-components` forbids mixing a component
  export with a plain constant in one file

### Model
- `newsPageModel.js` — pure client view rules: `splitItemsBySeen` (fresh vs
  older around the divider timestamp), `resolveDividerMarker` (hold the first
  non-null server marker for the whole visit), `displayExcerpt` (suppress
  link-aggregator boilerplate), `describeSourceHealth` (failing at 5+
  consecutive failures)

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- The server shapes the page payload (`buildNewsPagePayload` in
  `server/news/news-model.js`); this directory owns only presentation splits
  that depend on client-side visit state (the divider).
- `useDismissablePortal` here is `{ active: open, ref: panelRef, onDismiss:
  onClose }` — a single ref, no anchor, since the manage panel is a slide-over
  rather than an anchored popover (see `src/hooks/useDismissablePortal.js` for
  its current signature before adding a new consumer).
- News never generates Needs-You items and has no per-item read state — the
  seen-marker divider is the only "have I looked at this" signal (see the
  design spec's non-goals).

## Related

- `server/news/` — poller, models, and the API this tab consumes (see its map)
- `server/routes/news.js` — HTTP surface
- `src/hooks/useNews.js` — data hook (initial load, tab-visibility background
  refetch, manual refresh)
- `src/components/dashboard/DashboardShell.jsx` — mounts `NewsTab` as a
  `KeepAliveTab` (key `5`)
- `docs/exec-plans/active/2026-07-04-news-tab-design.md` — design spec
