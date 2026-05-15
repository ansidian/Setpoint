# EA Dashboard

EA Dashboard is a single-owner personal assistant surface that aggregates sensitive personal data. Authentication language should distinguish full dashboard access from partial setup or verification states.

## Language

**Dashboard Password**:
The existing shared secret that proves knowledge of the dashboard login credential.
_Avoid_: Master password, account password

**Passkey**:
A WebAuthn credential controlled by a trusted device, platform authenticator, or hardware security key.
_Avoid_: MFA code, recovery key

**Registered Passkey**:
The server-side record of a passkey credential that EA Dashboard can verify.
_Avoid_: Stored passkey, private key

**Pending Password Authentication**:
A short-lived state proving the dashboard password was accepted but full dashboard access has not yet been granted.
_Avoid_: Session, logged in

**WebAuthn Challenge**:
A short-lived one-time verification prompt created for passkey registration or authentication.
_Avoid_: Login session, recovery token

**Authenticated Session**:
The final dashboard session granted only after all required authentication steps are complete.
_Avoid_: Pending auth, partial login

**Scoped API Token**:
A bearer credential for explicitly opted-in automation routes, not a dashboard login credential.
_Avoid_: Session token, dashboard token

**Session Boundary Rotation**:
The rule that existing dashboard sessions are revoked or rotated when passkey requirements materially change.
_Avoid_: Passive session carryover

**Passkey Management**:
The authenticated Settings workflow for registering and deleting passkeys.
_Avoid_: Login recovery, passkey-only login

**Passkey Reset**:
A local operator recovery action that clears registered passkeys and returns future login to password-only setup mode.
_Avoid_: Recovery code, reset endpoint

**Passkey Prompt**:
The browser or authenticator ceremony used to prove control of a registered passkey during login.
_Avoid_: Manual second login page, passkey-only login

**Passkey Storage Separation**:
The owner preference that the passkey should live outside EA Dashboard and outside the password manager that stores the dashboard password.
_Avoid_: Bitwarden enforcement, dashboard-stored passkey

**Calendar Search**:
A modal-local calendar discovery mode that can query beyond the visible month while preserving the current calendar workspace.
_Avoid_: Visible-month filter, command palette search

**Calendar Search Scope**:
The active calendar workspace searched by **Calendar Search**.
_Avoid_: Global calendar corpus, all-feeds search

**Calendar Search Endpoint**:
A server-owned API that resolves **Calendar Search** queries instead of relying only on the client’s visible calendar cache.
_Avoid_: Client-only search, month-cache filter

**Calendar Search Mirror**:
A local Google Calendar event read model used to answer **Calendar Search** without making provider search calls.
_Avoid_: Calendar source of truth, live calendar replacement

**Calendar Search Occurrence**:
A dated Google Calendar event instance stored in the **Calendar Search Mirror** for searching and activation.
_Avoid_: Raw recurring series, calendar rule

**Calendar Search Mirror Freshness**:
The bounded staleness contract that tells **Calendar Search** whether mirrored Google Calendar results are current enough to show.
_Avoid_: Perfect sync, silent drift

**Calendar Search Mirror Sync**:
The quiet background process that refreshes **Calendar Search Occurrences** from Google Calendar for the search mirror.
_Avoid_: Calendar push channel, live search fallback

**Calendar Search Coverage**:
The source-specific boundary of what **Calendar Search** can truthfully search.
_Avoid_: Infinite calendar history, all provider data

**Calendar Search Activation**:
The action of choosing a **Calendar Search** result and moving the calendar workspace to that item.
_Avoid_: Preview-only result, detached detail

**Calendar Search Ranking**:
The deterministic timeline ordering of **Calendar Search** results by result date.
_Avoid_: Semantic ranking, fuzzy AI rank, match-quality-first order

**Calendar Search Typeahead**:
The debounced query interaction for **Calendar Search**.
_Avoid_: Submit-only search, search-all-empty-query

**Calendar Search Keyboarding**:
The keyboard interaction model for opening, navigating, activating, and closing **Calendar Search**.
_Avoid_: Calendar hotkeys inside search input, Tab search mode

**Calendar Event Selection Set**:
A transient set of selected Google Calendar events used for batch calendar actions within the Events workspace.
_Avoid_: Multi-select chips, selected deadlines, bulk edit set

**Calendar Event Clipboard**:
A modal-local copied event payload used to paste one or more Google Calendar events inside the calendar workspace.
_Avoid_: OS clipboard, exported calendar data

**Search Results Rail**:
A slim calendar side rail that lists **Calendar Search** results separately from the agenda rail.
_Avoid_: Search drawer, search modal

**Three-Rail Calendar Workspace**:
The desktop calendar modal layout with search results on the left, month grid in the center, and agenda/detail rail on the right.
_Avoid_: Replacing agenda on desktop, search overlay

**Mini Calendar**:
A compact calendar grid in the calendar workspace that orients and navigates the agenda rail by date.
_Avoid_: Agenda Month Navigator, mini-month, sidebar calendar

**Mini Calendar Activation**:
The action of choosing a date in the **Mini Calendar** to select that date and land the agenda rail on the same date.
_Avoid_: Preview-only date selection, partial agenda jump

**Mini Calendar Activity Marker**:
A compact date-level signal in the **Mini Calendar** showing count or density of active calendar workspace content on that date.
_Avoid_: Event chip, source legend, decorative dot

**Deadline Overlay**:
A toggleable layer of deadline items inside the Events workspace.
_Avoid_: Deadlines view, separate deadlines workspace, Canvas view

**Agenda Row Hover Preview**:
A temporary **Mini Calendar** date emphasis shown while hovering or focusing an agenda rail item. It wraps the previewed date number and its **Mini Calendar Activity Markers** as one visual target.
_Avoid_: Hover selection, delayed tooltip, agenda preview mode

## Relationships

- EA Dashboard has one owner; passkey authentication uses that owner identity and does not introduce usernames or multi-account login.
- A **Dashboard Password** can create **Pending Password Authentication** when a **Registered Passkey** exists.
- A **Passkey** verifies against exactly one **Registered Passkey** record.
- An **Authenticated Session** is created only after **Pending Password Authentication** is followed by successful **Passkey** verification.
- A **Scoped API Token** can remain valid for its narrow automation scope after passkey enforcement, but it does not create or replace an **Authenticated Session**.
- **Session Boundary Rotation** happens when the first **Registered Passkey** is added or a **Registered Passkey** is deleted, so old sessions do not outlive a material authentication boundary change.
- **Passkey Storage Separation** is an owner operating rule and product-copy requirement, not a reliable browser-enforceable guarantee.
- **Pending Password Authentication** is held in an `httpOnly`, 5-minute cookie; browser JavaScript should only receive flow state, not a reusable pending-auth token.
- A **WebAuthn Challenge** expires after 5 minutes and is consumed on success or failure; failed passkey verification does not end still-valid **Pending Password Authentication**.
- Removing the final **Registered Passkey** intentionally returns future login to password-only setup mode, but only from an existing **Authenticated Session** and with **Session Boundary Rotation**.
- **Passkey Management** requires an **Authenticated Session**; it does not add a separate fresh reauthentication step in the initial passkey rollout.
- **Pending Password Authentication** can complete login with an existing **Registered Passkey**, but it cannot register a new **Passkey**.
- **Passkey Reset** is performed through local server or database access, not through a public HTTP recovery endpoint or recovery-code credential.
- **Passkey Reset** clears registered passkeys, pending authentication, WebAuthn challenges, and authenticated sessions so the next login starts cleanly in password-only setup mode.
- **Pending Password Authentication** is cleared by login cancellation or logout cleanup, but passkey rollout does not require a new front-facing dashboard logout control.
- After password success, the **Passkey Prompt** starts immediately when a **Registered Passkey** exists; manual controls are fallback/retry affordances, not the primary flow.
- Password attempts and passkey attempts are throttled separately; a failed or canceled **Passkey Prompt** does not count as a failed **Dashboard Password** attempt.
- **Authenticated Sessions** remain the only remembered access state; there is no separate trusted-browser or remember-device bypass for future logins.
- **Passkey Management** supports deleting individual **Registered Passkeys** in Settings, while reset-all recovery stays local through **Passkey Reset**.
- Deleting an individual **Registered Passkey** revokes existing authenticated sessions and may issue a fresh current-browser session for the authenticated browser performing the deletion.
- **Calendar Search** opens from the calendar modal header or Cmd/Ctrl+F and shows matches in a **Search Results Rail**.
- **Calendar Search** may fetch a bounded multi-month window instead of only filtering the visible month.
- **Calendar Search Scope** follows the active view: Events searches events plus visible deadline-overlay data, Bills searches bills only.
- A **Calendar Search Endpoint** is the preferred implementation path for search because the owner values broader lookup more than a bounded cache-only compromise.
- A **Calendar Search Mirror** may answer Events search, but it does not replace live Google Calendar reads for the normal Events calendar range or dashboard surfaces.
- A **Calendar Search Mirror** owns the same rolling Events search window as **Calendar Search Coverage**: 12 months back and 18 months forward from today.
- A **Calendar Search Mirror** stores **Calendar Search Occurrences** expanded by Google Calendar over the rolling window, not raw recurring series that EA Dashboard expands itself.
- A **Calendar Search Occurrence** is searchable by event title, location, description, and calendar source label, while preserving activation fields needed to reopen the existing calendar detail behavior.
- Calendar writes continue to use Google Calendar as the provider of record; a **Calendar Search Mirror** is refreshed or marked stale after writes.
- Simple non-recurring calendar writes may update matching **Calendar Search Occurrences** immediately, but recurring writes mark the affected Google calendar dirty and rely on **Calendar Search Mirror Sync** for repair.
- **Calendar Search Mirror Freshness** is bounded eventual consistency: normal search may return recently stale mirrored results with honest coverage, while uninitialized, old, or degraded mirrors trigger background repair instead of pretending to be live Google.
- **Calendar Search Mirror Sync** uses quiet incremental polling and write-triggered dirtying first; Google Calendar push notifications are deferred unless polling cannot meet the freshness contract.
- **Calendar Search** does not automatically fall back to live Google provider search when the **Calendar Search Mirror** is stale, empty, or degraded; it returns honest coverage and schedules repair instead.
- **Calendar Search** opens immediately when the **Calendar Search Mirror** is uninitialized; initial indexing is reported through coverage rather than blocking the search request.
- **Calendar Search Coverage** is per source: Events search may return deadline-overlay matches while Google event mirror coverage is initializing, stale, or degraded.
- A mirror-backed **Calendar Search Endpoint** preserves **Calendar Search Ranking**; the mirror changes freshness and provider-call behavior, not the result ordering contract.
- **Calendar Search Coverage** is source-specific: Events may use provider-backed Google Calendar search, Events deadlines use server-available deadline data, and Bills searches the local Bills mirror.
- **Calendar Search Coverage** must be honest in empty or limited states; Bills mirror coverage is not the same as searching all of Actual forever.
- **Calendar Search Activation** navigates the modal to the result month, selects the result date and item, and opens the existing calendar detail behavior.
- **Calendar Search Activation** keeps the **Search Results Rail** open with its current query and results while the calendar workspace navigates or loads.
- **Calendar Search Ranking** filters by deterministic match quality but displays matching results in date order from oldest to newest so the **Search Results Rail** reads like a timeline.
- **Calendar Search Endpoint** should query provider-backed event sources from a today-centered window before backfilling the broader coverage window, so broad recurring-event searches do not exhaust provider limits on old matches.
- **Calendar Search Typeahead** runs after a short debounce once the query has at least two characters; Enter activates the highlighted result, not the search request itself.
- **Calendar Search Typeahead** keeps prior results visible while the next request is pending and ignores stale responses.
- **Calendar Search Keyboarding** opens search with Cmd/Ctrl+F, uses Up/Down to move the highlighted result while focus stays in the input, Enter to activate, and Escape to clear the query before closing an already-empty rail.
- **Calendar Search Keyboarding** suspends calendar single-key hotkeys while the search input is focused.
- A **Calendar Event Selection Set** is separate from the single selected calendar item that opens detail, and it contains only writable Google Calendar events.
- Modifier-clicking a selected Google Calendar event toggles its membership in the **Calendar Event Selection Set**.
- A **Calendar Event Selection Set** has a distinct visual state from the single selected calendar item that opens detail.
- A **Calendar Event Selection Set** can be changed from any eligible Google event representation in the Events workspace, including grid chips, overflow chips, span segments, and agenda rows.
- A **Calendar Event Selection Set** identifies recurring Google Calendar occurrences separately from their series and treats a multi-day non-recurring event as one event.
- A **Calendar Event Selection Set** is built by explicit modifier toggles, not range selection.
- Context-menu copy, delete, and color actions apply to the **Calendar Event Selection Set** when opened from an event inside the set; outside the set they apply only to the context event.
- Batch delete and color actions on a **Calendar Event Selection Set** affect selected recurring occurrences only, not broader recurring series scopes.
- Batch delete of a **Calendar Event Selection Set**, including keyboard-initiated delete, requires confirmation before deletion.
- Batch delete clears the **Calendar Event Selection Set** after completion, while batch color leaves the set selected.
- Dirty calendar editor protection takes precedence over changing a **Calendar Event Selection Set**.
- Ordinary single-item calendar selection replaces a **Calendar Event Selection Set**, but modifier-held day clicks do not; month navigation alone does not.
- While building a **Calendar Event Selection Set**, overflow panels are selection helpers: opening overflow does not clear the set, and outside clicks do not dismiss overflow.
- Copying a **Calendar Event Selection Set** creates a **Calendar Event Clipboard** inside EA Dashboard rather than writing event data to the operating-system clipboard.
- A non-empty **Calendar Event Selection Set** takes precedence over single selected event detail when copying.
- Pasting a **Calendar Event Clipboard** preserves the selected events' relative date offsets from the earliest copied event date.
- A **Calendar Event Clipboard** pastes onto the calendar's active selected date.
- A **Calendar Event Clipboard** is ordered by source event date and time, not by click order.
- Pasting a **Calendar Event Clipboard** clears the **Calendar Event Selection Set** while leaving the copied clipboard available for later paste.
- Pasting recurring events from a **Calendar Event Clipboard** creates standalone Google Calendar events, not new recurring series.
- Copying and pasting a **Calendar Event Clipboard** is a silent power-user flow; partial failures do not roll back successful Google Calendar creates and do not automatically retry.
- A **Search Results Rail** is not the agenda rail; choosing a result should route through the existing calendar selection and detail behavior.
- A **Search Results Rail** uses agenda-like date headers and source-colored result markers; it should not render standalone source-type text when a more specific result detail such as event location, course/project, or bill metadata is available.
- A **Search Results Rail** dims result rows dated before today in the dashboard timezone, but date headers remain full-strength timeline anchors.
- A **Search Results Rail** keeps chronological result order but initially centers completed result sets near today, preferring today's date group, then the first future group, then the most recent past group.
- A **Three-Rail Calendar Workspace** is the desktop target when search is open; smaller or stacked layouts may replace the agenda rail only when there is not enough room.
- A **Mini Calendar** is distinct from the month grid, agenda rail, and **Search Results Rail**; it is a compact date navigation surface for the current calendar workspace.
- A **Mini Calendar** accompanies every agenda-backed calendar workspace, not only the Events workspace.
- A **Mini Calendar** controls the same visible calendar month as the main calendar workspace; it does not maintain an independent preview month.
- **Mini Calendar Activation** updates calendar selection and moves the agenda rail to the activated date; the agenda rail should finish landed on that target date rather than stopping between dates.
- **Mini Calendar Activation** prioritizes accurate target landing over animation; long-distance agenda jumps should be instant or distance-aware rather than forced smooth.
- A **Mini Calendar Activity Marker** is a count or density signal, not a replacement for agenda rows, event chips, bill rows, or deadline rows.
- A **Mini Calendar Activity Marker** represents content in the active calendar workspace, not all calendar-related feeds at once.
- **Mini Calendar Activity Markers** reflect the agenda rail's filtered content model rather than a separate month-grid cache.
- **Mini Calendar Activity Markers** still render on adjacent-month dates inside the stable six-row **Mini Calendar** grid when the active workspace has confirmed content there.
- A **Mini Calendar Activity Marker** has a hard maximum of four count signals per date; the fourth signal represents four or more items.
- Deadline items use a checkmark-style **Mini Calendar Activity Marker** instead of a dot; a date shows at most one deadline checkmark, and it appears after dot markers.
- Multi-day all-day events contribute **Mini Calendar Activity Markers** on every date they touch.
- An **Agenda Row Hover Preview** previews the hovered agenda item's date in the **Mini Calendar** using the item's source color and encloses the date's **Mini Calendar Activity Markers**.
- An **Agenda Row Hover Preview** takes visual precedence over the Mini Calendar's selected-date and today treatments while the agenda item is hovered.
- An **Agenda Row Hover Preview** appears without intentional delay and may fade out subtly after the hover ends.
- Keyboard focus on an agenda rail item produces the same **Agenda Row Hover Preview** as pointer hover.
- For a multi-day all-day event, **Agenda Row Hover Preview** spans the event's covered Mini Calendar dates as one continuous pill-like preview with the date numbers and markers centered inside the pill.
- Owner-driven agenda rail scrolling updates the **Mini Calendar** selection from the topmost active date header.
- Double-clicking a date in the **Mini Calendar** creates a calendar event seeded to that date, regardless of the active calendar workspace.
- The first click in a Mini Calendar double-click still performs **Mini Calendar Activation** immediately; the second click additionally opens event creation.
- Dirty calendar editor protection takes precedence over **Mini Calendar Activation** and Mini Calendar event creation.
- A **Deadline Overlay** belongs to the Events workspace; it is not a separate top-level calendar workspace.
- When the **Deadline Overlay** is visible, deadline items participate in Events workspace **Mini Calendar Activity Markers**.
- **Mini Calendar Activity Markers** follow the active workspace's visible overlay and filter state; hidden deadline items do not contribute markers.
- In a **Three-Rail Calendar Workspace**, the **Mini Calendar** remains with the visible agenda rail while **Calendar Search** is open; when search replaces the agenda rail on narrower layouts, the **Mini Calendar** is hidden with that rail.
- A **Mini Calendar** shows adjacent-month dates to keep a stable compact calendar grid; activating an adjacent-month date navigates the shared calendar workspace month and selects that date.
- A **Mini Calendar** uses a stable six-row grid so its height does not shift the agenda rail between months.
- A **Mini Calendar** stays fixed above the agenda rail content rather than scrolling away with agenda rows.
- A **Mini Calendar** ignores wheel input; wheel gestures should not navigate months from the Mini Calendar.
- A **Mini Calendar** does not provide internal keyboard grid navigation in the initial behavior contract.
- Mini Calendar dates remain ordinary focusable controls for activation even without internal keyboard grid navigation.
- The **Mini Calendar** date grid renders immediately for the visible month; activity markers populate from confirmed available data rather than replacing the whole Mini Calendar with a loading skeleton.
- Owner-driven agenda rail scrolling may update **Mini Calendar** date selection, but it does not navigate the shared calendar workspace month.

## Example Dialogue

> **Dev:** "After the **Dashboard Password** succeeds, should we create an **Authenticated Session**?"
> **Domain expert:** "Only when no **Registered Passkey** exists. Otherwise create **Pending Password Authentication** and require the **Passkey** before full access."

## Flagged Ambiguities

- "Outside Bitwarden" was resolved as **Passkey Storage Separation**: EA Dashboard should recommend and support device or hardware-key passkeys, but should not claim it can reliably detect or block Bitwarden-hosted passkeys through browser WebAuthn.
- "Pending auth token" was resolved as cookie-held **Pending Password Authentication**, not a JSON token the frontend stores or passes manually.
- "Delete passkey" includes deleting the final **Registered Passkey**; this is a deliberate recovery path, not an invalid state.
- "Search in the calendar modal" was resolved as **Calendar Search**, not a visible-month filter: the happy path is broader calendar lookup, with an acceptable bounded multi-month search window when needed for performance.
- "Global calendar search" was rejected for the first calendar modal search: **Calendar Search Scope** stays active-view based, with Events including its deadline overlay items and Bills staying Bills-only.
- "Server search" was chosen over a bounded client-cache search as the preferred path for **Calendar Search**, even if individual sources still need explicit provider or mirror boundaries.
- "Global" in **Calendar Search** was resolved as best available source-wide search with explicit **Calendar Search Coverage**, not live-querying every provider with no boundary.
- "Calendar event mirror" was resolved as a **Calendar Search Mirror** first, not a new source of truth for all calendar event reads.
- "Does not drift from Google" was resolved as **Calendar Search Mirror Freshness** with bounded, visible staleness and repair, not a claim of perfect lockstep sync.
- "Provider fallback" for mirrored Events search was rejected for normal **Calendar Search Typeahead**; falling back to live Google would reintroduce provider latency and quota limits.
- "Selecting a search result" was resolved as **Calendar Search Activation**, not an independent preview surface.
- "Smart ranking" was rejected for **Calendar Search** display order; use deterministic **Calendar Search Ranking** as an oldest-to-newest timeline after filtering matches.
- "Left search rail" was resolved as a **Three-Rail Calendar Workspace** on desktop, with responsive fallback only for constrained layouts.
- "Typing in calendar search" was resolved as **Calendar Search Typeahead**, not an Enter-to-submit flow.
- "Calendar search keyboard behavior" was resolved as **Calendar Search Keyboarding**, with search input focus suspending the modal's single-key calendar hotkeys.
- "Multi-select chip events" was resolved as a **Calendar Event Selection Set**, not an extension of single-item detail selection or deadline overlay selection.
- "Cmd-C/Cmd-V for selected event chips" was resolved as a **Calendar Event Clipboard**, not integration with the operating-system clipboard.
- "Retry failed multi-event paste creates" was rejected for the initial **Calendar Event Clipboard** because duplicate-safe create idempotency is out of scope.
- "Mini calendar" was resolved as **Mini Calendar**, not **Agenda Month Navigator**, because it is the only compact calendar surface in the project and the owner-facing name is self-explanatory.
- "Clicking a mini calendar date" was resolved as **Mini Calendar Activation**, not a selection-only preview.
- "Mini calendar dots" was resolved as **Mini Calendar Activity Markers**, not detailed event chips or a standalone source legend.
- Binary **Mini Calendar Activity Markers** were rejected as too weak; marker count or density is the useful orientation signal, with a hard cap of four.
- "Deadlines view" was resolved as **Deadline Overlay** for the current calendar product language; deadlines live inside Events behind a show/hide control.
