# Lib Map

Shared, mostly-pure helpers with no owning feature directory — cross-cutting utilities consumed by dashboard, calendar, inbox, and the shell.

## Files

- `actualMetadata.js` — shared Actual Budget metadata cache (accounts/payees/categories), single fetch, invalidated on the bills SSE change signal
- `bill-utils.js` — bill amount/date formatting helpers
- `breakpoints.js` — `MOBILE_MAX_WIDTH` — single source of truth for the app's mobile gate
- `briefing-email-state.js` — unread-count + status-map helpers for briefing email lanes
- `calendar-links.js` — URL/href/bare-URL detection and Zoom-link resolution for event descriptions
- `dashboard-helpers.js` — urgency style tokens, greeting pools, Pacific-time epoch helpers
- `email-links.js` — builds a Gmail web URL from an email's uid + account
- `focus-windows.js` — computes protected/short focus windows around deadlines and events
- `icons.js` — lucide icon name → component resolver (`resolveIcon`) for briefing/category icon fields
- `icons.jsx` — universal icon renderer (lucide name or known emoji); unknown input falls back to Sparkles
- `open-day-summary.js` — "what's due/urgent today" summary builder for deadlines
- `scrollLock.js` — ref-counted scroll lock (`acquireScrollLock`) shared by BottomSheet and the AddTaskPanel mobile placement so nested opens/closes can never strand or prematurely release the lock
- `shell-helpers.js` — shared dashboard/hero/timeline/rail helpers (day bucketing, due-date-to-ms, duration formatting), kept pure and React-free
- `sseStream.js` — reads a fetch() response body as text/event-stream frames, calling `onEvent` per JSON payload
- `textContrast.js` — WCAG contrast tiers for the app's readable-text colors
- `triageSoundGate.js` — dedup + coalesce gate shared by every triage-sound publisher
- `triageSoundPlayback.js` — Web Audio playback constants + the audio-unlock/gain/fade-out mechanics for triage sounds
- `triageSoundRouter.js` — resolves which triage sound plays for a given trigger against the user's sound settings
- `triageSoundSettings.js` — triage sound lane-scope constants + settings normalization
- `utils.ts` — `cn()` — clsx + tailwind-merge className combinator

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)
