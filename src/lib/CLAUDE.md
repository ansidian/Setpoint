# Lib Map

Shared, mostly-pure helpers with no owning feature directory — cross-cutting utilities consumed by dashboard, calendar, inbox, and the shell.

## Files

- `actualMetadata.ts` — shared Actual Budget metadata cache (accounts/payees/categories), single fetch, invalidated on the bills SSE change signal
- `apiFetch.ts` — shared JSON request transport, timeout/auth error handling, and build-time demo adapter boundary
- `bill-utils.ts` — bill amount/date formatting helpers
- `breakpoints.ts` — `MOBILE_MAX_WIDTH` — single source of truth for the app's mobile gate
- `briefing-email-state.ts` — unread-count + status-map helpers for briefing email lanes
- `calendar-links.ts` — URL/href/bare-URL detection and Zoom-link resolution for event descriptions
- `dashboard-helpers.ts` — urgency style tokens, greeting pools, Pacific-time epoch helpers
- `email-links.ts` — builds a Gmail web URL from an email's uid + account
- `focus-windows.ts` — computes protected/short focus windows around deadlines and events
- `icons.ts` — lucide icon name → component resolver (`resolveIcon`) for briefing/category icon fields
- `Icon.tsx` — universal icon renderer (lucide name or known emoji); unknown input falls back to Sparkles
- `open-day-summary.ts` — "what's due/urgent today" summary builder for deadlines
- `scrollLock.ts` — ref-counted scroll lock (`acquireScrollLock`) shared by BottomSheet and the AddTaskPanel mobile placement so nested opens/closes can never strand or prematurely release the lock
- `shell-helpers.ts` — shared dashboard/hero/timeline/rail helpers (day bucketing, due-date-to-ms, duration formatting), kept pure and React-free
- `sseStream.ts` — reads a fetch() response body as text/event-stream frames, calling `onEvent` per JSON payload
- `textContrast.ts` — WCAG contrast tiers for the app's readable-text colors
- `todoistSetupApi.ts` — authenticated Todoist setup/status client calls with demo-safe routing through `apiFetch`
- `triageSoundGate.ts` — dedup + coalesce gate shared by every triage-sound publisher
- `triageSoundPlayback.ts` — Web Audio playback constants + the audio-unlock/gain/fade-out mechanics for triage sounds
- `triageSoundRouter.ts` — resolves which triage sound plays for a given trigger against the user's sound settings
- `triageSoundSettings.ts` — triage sound lane-scope constants + settings normalization
- `utils.ts` — `cn()` — clsx + tailwind-merge className combinator

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)
