# News Map

The News tab: a fifth shell tab, topic-sectioned RSS/HN headline river with a
seen-marker divider and an in-tab source manager. Entry point is `NewsTab.tsx`
(mounted as a lazy `KeepAliveTab` by `DashboardShell`, first-visit-gated like
calendar since it triggers a real fetch on mount). Desktop-only in v1.

## Files

### Tab + reading surface
- `NewsTab.tsx` — owns `useNews`, the held seen-divider marker (adjusted
  during render on a `news` identity change — not an effect, to satisfy the
  repo's ref/set-state-in-effect lint rules), the manage-panel open state, and
  the seen-marker bump-on-leave/pagehide lifecycle; also owns the persisted
  All/New mode (localStorage `news.hideSeen`), the mark-caught-up action
  (fire-and-forget `markNewsSeen(now)` + immediate local re-split), and the
  source-manager target topic. The manager closes when the tab becomes inactive.
- `NewsView.tsx` — sticky toolbar (new-count summary, truthful last-check time,
  All/New segmented control, Mark caught up, refresh, Sources) + a sticky topic
  index beside stable full-width topic bands; loading skeleton (static bars, no
  spinner), error/first-run empty states
- `NewsTopicSection.tsx` — one sentence-case topic band with a "{n} new" accent
  pill, actionable source-health status, a lead lane (newest fresh item, or
  newest item at all when quiet), compact headline lane, and the seen
  divider (only when both fresh and visible-older are non-empty), then older
  rows capped at 8 (5 total when quiet, header dimmed); row selection comes
  from `planTopicSection` (owns the caps + lead/divider/older split, and the
  hide-seen branch); no-items topics show "No stories yet", quiet topics
  under hide-seen show a "Caught up" stub instead of their old rows
- `NewsItemRow.tsx` — one headline; the whole row is the link
  (`target="_blank"`), hover/focus styling via `.news-row` in `index.css`
  (row tint + title→accent). Title color lives on `.news-row` (inherited by
  `.news-row-title` via `color: inherit`, not an inline span style), so a
  `.news-row:visited` rule quiets already-clicked headlines. Title wraps and
  clamps at 2 lines (never one-line truncated). `variant="lead"` adds a
  2-line excerpt (filtered by `displayExcerpt` — hnrss "Article URL:"
  boilerplate suppressed) and the feed thumbnail (92×76px,
  `referrerPolicy="no-referrer"`, hidden on error). Meta line: favicon
  (DuckDuckGo icon service, hidden on error) + source + relative time

### Manage panel
- `NewsManagePanel.tsx` — modal right-side slide-over (`createPortal` to
  `document.body`, `useDismissablePortal`) with contained focus, a topic
  overview, and focused per-topic detail (including direct open from a health
  cue). It keeps the existing topic create/rename/reorder/delete
  (inline "Confirm?" second click, no modal), per-source enable toggle +
  health badge + delete, HN `minPoints` inline edit, per-topic mute-term
  chips (add via a "Mute keyword…" input, remove via chip ×, both calling
  `updateNewsTopicMutedTerms`), mounts `NewsCatalogPicker` when the owner has
  zero topics
- `NewsAddSourceForm.tsx` — paste-URL → `previewNewsSource` → confirm
  (`createNewsSource`), with an "HN keyword" mode toggle for query + points
- `NewsCatalogPicker.tsx` — starter-bundle checkboxes (topic name + source
  count) → `importNewsStarterTopics`; also the first-run empty-state body
- `manageUi.tsx` — shared `ManageButton` (150ms hover/focus motion, matches
  every other enabled control here)
- `manageStyles.ts` — shared `manageInputStyle`; split out of `manageUi.tsx`
  because `react-refresh/only-export-components` forbids mixing a component
  export with a plain constant in one file

### Model
- `newsPageModel.ts` — pure client view rules: `splitItemsBySeen` (fresh vs
  older around the divider timestamp), `resolveDividerMarker` (hold the first
  non-null server marker for the whole visit), `displayExcerpt` (suppress
  link-aggregator boilerplate), `describeSourceHealth` (generic failure at 5+
  consecutive failures; enabled Reddit 429s are delayed immediately),
  `summarizeTopicSourceHealth` (topic-level actionable status), and
  `planTopicSection` (the full visible-rows plan for a
  topic — lead/fresh/divider/older selection and caps, including the
  hide-seen branch)

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- The server shapes the page payload (`buildNewsPagePayload` in
  `server/news/news-model.ts`); this directory owns only presentation splits
  that depend on client-side visit state (the divider).
- `useDismissablePortal` here uses a single panel ref plus `onActivate` and
  `onTabKey` for modal focus entry/containment; there is no anchor because the
  manager is a slide-over (see `src/hooks/useDismissablePortal.js`).
- News never generates Needs-You items and has no per-item read state — the
  seen-marker divider is the only "have I looked at this" signal (see the
  design spec's non-goals). The "New only" toggle doesn't change this: it's
  still positional (hides the divider-and-older rows), not tracked per item.

## Related

- `server/news/` — poller, models, and the API this tab consumes (see its map)
- `server/routes/news.ts` — HTTP surface
- `src/hooks/useNews.ts` — data hook (initial load, tab-visibility background
  refetch, manual refresh)
- `src/components/dashboard/DashboardShell.tsx` — mounts `NewsTab` as a
  `KeepAliveTab` (key `5`)
- `docs/exec-plans/completed/2026-07-04-news-tab-design.md` — design spec
