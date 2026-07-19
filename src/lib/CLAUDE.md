# Lib Map

Shared, mostly-pure helpers with no owning feature directory — cross-cutting utilities consumed by dashboard, calendar, inbox, and the shell.

## Files

- `actualMetadata.ts` — shared Actual Budget metadata cache (accounts/payees/categories), single fetch, invalidated on the bills SSE change signal
- `apiFetch.ts` — shared JSON request transport, timeout/auth error handling, and build-time demo adapter boundary
- `bill-utils.ts` — bill amount/date formatting helpers
- `breakpoints.ts` — `MOBILE_MAX_WIDTH` — single source of truth for the app's mobile gate
- `calendar-links.ts` — URL/href/bare-URL detection and Zoom-link resolution for event descriptions
- `dashboard-helpers.ts` — urgency style tokens, greeting pools, Pacific-time epoch helpers
- `email-links.ts` — builds a Gmail web URL from an email's uid + account
- `gmailPubSubSetupApi.ts` — authenticated Gmail Pub/Sub setup/status client calls through the demo-safe API boundary
- `icons.ts` — lucide icon name → component resolver (`resolveIcon`) for briefing/category icon fields
- `Icon.tsx` — universal icon renderer (lucide name or known emoji); unknown input falls back to Sparkles
- `onboardingModel.ts` — locked capability-led onboarding sequence and pure persisted-progress projection
- `onboardingApi.ts` — authenticated onboarding progress calls plus demo-only in-memory behavior
- `scrollLock.ts` — ref-counted scroll lock (`acquireScrollLock`) shared by BottomSheet and the AddTaskPanel mobile placement so nested opens/closes can never strand or prematurely release the lock
- `shell-helpers.ts` — shared dashboard/hero/timeline/rail helpers (day bucketing, due-date-to-ms, duration formatting), kept pure and React-free
- `sseStream.ts` — reads a fetch() response body as text/event-stream frames, calling `onEvent` per JSON payload
- `todoistSetupApi.ts` — authenticated Todoist setup/status client calls with demo-safe routing through `apiFetch`
- `triageSoundGate.ts` — dedup + coalesce gate shared by every triage-sound publisher
- `triageSoundPlayback.ts` — Web Audio playback constants + the audio-unlock/gain/fade-out mechanics for triage sounds
- `triageSoundRouter.ts` — resolves which triage sound plays for a given trigger against the user's sound settings
- `triageSoundSettings.ts` — triage sound lane-scope constants + settings normalization
- `utils.ts` — `cn()` — clsx + tailwind-merge className combinator

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)
