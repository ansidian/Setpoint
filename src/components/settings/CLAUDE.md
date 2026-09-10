# Settings Map

The settings surface: a Connections directory plus Automation, Finance, and System sections inside the centered `/settings` modal. The viewport-responsive shell grows to 1920×1600 CSS pixels with wider navigation spacing; form content stays within 1280px and scrolls independently. Financial workflows live at `/finance`, owned by `src/components/financial/`; Settings is visited only for connection repair and finance preferences. `src/pages/WorkspaceRoute.tsx` keeps Dashboard mounted beneath it and owns close/history/focus return. Connections owns external-service setup and health; the feature tabs retain behavior and owner-security controls. `settings-core.ts` owns tab routing and `settings-ui.tsx` owns shared layout primitives, persistent heading, responsive section navigation, and independently scrolling content.

## Files

### Chrome + core
- `SettingsChrome.tsx` — loading skeletons during settings fetch/transition
- `settings-core.ts` — button class constants, tab definitions, tab-from-URL routing
- `settings-ui.tsx` — StatusPill, SaveStatus, SettingsCard, SkeletonCard, SettingsLayout
- `settingsTypes.ts` — shared Settings card state, patch, and account prop contracts
- `connectionModel.ts` — fixed connection definitions plus pure service-level status projection
- `connectionDirectoryModel.ts` — canonical/legacy connection hash parsing, allowlisted advanced targets, and directory summary/action projection
- `ConnectionsDirectory.tsx` — grouped, one-open disclosure directory synchronized to the URL hash, with progress-gated onboarding continuation
- `ConnectionPanelContent.tsx` — service-to-existing-control ownership mapping, expanded state evidence, and targeted Advanced setup routing
- `ConnectionDependencyPrompt.tsx` — concise setup/repair prerequisite prompt with canonical Connections deep links
- `SensitiveActionStepUp.tsx` — reusable inline recent-password confirmation that retries a deferred credential action without losing form state
- `sensitiveActionStepUpModel.ts` — deferred sensitive-action state and password-step-up retry controller
- `featureDependencyModel.ts` — pure Automation/Finance visibility and AI provider-selection projection
- `AccountsList.tsx` — draggable, editable provider-filtered account rows with icon/color pickers

### Sections (one per tab)
- `sections/ConnectionsSettingsSection.tsx` — directory shell that binds projected service rows, onboarding progress, and advanced deep links to connection panels
- `sections/ActualBudgetSettingsSection.tsx` — Finance preferences: saved financial profiles, browser alerts and utility pay links, with automatic budget-scoped Actual metadata, explicit failure retry, and one-time unsaved review-draft or partial email-seed navigation
- `sections/EmailAutomationSettingsSection.tsx` — triage mode, sounds, AI models, extraction, lookback
- `sections/SystemSettingsSection.tsx` — passkeys and API tokens

### Cards: AI + automation
- `cards/AlfredAiModelCard.tsx` — Alfred provider/model selection for new conversations; remains available without an email connection
- `cards/EmailAiModelCard.tsx` — email triage LLM provider/model selection with fallbacks
- `cards/EmailTriageModeCard.tsx` — triage automation toggle (auto/real/no-model/paused) with a labeled legacy usage glance; current usage lives in AI analytics
- `cards/BillExtractionAiCard.tsx` — bill extraction model choice, separate from triage model
- `cards/TriageSoundSettingsCard.tsx` — sound lanes, shared volume, per-trigger playback; Finance renders its scoped Actual recording control
- `cards/ImportantSendersCard.tsx` — auto-learned and manual important sender lists
- `cards/TrustedRemoteContentCard.tsx` — persisted exact-sender + receiving-account remote-image trust list and removal

### Cards: financial preferences
- `cards/FinancialProfilesCard.tsx` — compact profile list and explicit editor for exact sender identity, named Actual destinations; classified email seeds start enabled and leave unknown targets unset, and explicitly disabled profiles remain editable offline
- `cards/financialProfileModel.ts` — profile form defaults, navigation-draft projection, validation, target options and destination summaries; internal target IDs never become display labels

- `cards/UtilityMappingsCard.tsx` — compact budget-bound utility rows with one Actual Schedule, its derived read-only payee and inline pay URL, preserving source matching
- `cards/UtilityPayLinksCard.tsx` — inline utility pay URL field and additional schedule links within Utility mappings; source for the calendar "Pay Online" button

### Cards: connections + security
- `cards/GoogleWorkspaceAccountsPanel.tsx` — Gmail/Calendar account add, reconnect, edit, reorder, and removal
- `cards/ICloudMailAccountsPanel.tsx` — iCloud IMAP account add, reconnect, edit, reorder, and removal
- `cards/TodoistCard.tsx` — personal-token default plus advanced Todoist app migration, OAuth, callback, and webhook setup
- `cards/useTodoistSetup.ts` — Todoist credential workflow: write-only candidates, password-step-up retries, pending application lifecycle, and confirmation-gated disconnect; tested through hook state independently of presentation
- `cards/DiscordRemindersCard.tsx` — Discord webhook URL + user ID for private reminder delivery, with test-send
- `cards/WeatherLocationCard.tsx` — city geocode → lat/lng patch for dashboard weather snapshots
- `cards/HomeLocationCard.tsx` — Places-backed atomic Home selection/removal for driving Time-to-Leave estimates
- `cards/ActualBudgetConnectionCard.tsx` — Actual server URL/auth config, budget cache hydration
- `cards/financial-review/FinancialReviewNotificationsControl.tsx` — explicit browser permission control and delivery availability; demo is inert
- `cards/BriefingSchedulesCard.tsx` — snapshot window boundaries with FLIP reorder animation
- `cards/ApiTokensCard.tsx` — API token list/create/revoke with scopes and expiry
- `cards/PasskeysCard.tsx` — passkey registration/deletion, explicit auth mode, password step-up/change, and recovery-code regeneration
- `cards/CanonicalDomainCard.tsx` — recent-auth-gated canonical URL preview/change flow with passkey and provider callback impact
- `cards/CoreProviderCredentialsCard.tsx` — shared write-only test-and-save rows for AI, weather, and Places instance credentials
- `cards/GoogleOAuthCredentialsCard.tsx` — pending Google application pair, source migration, callback, and authorization validation entry
- `cards/GmailRealtimeCard.tsx` — optional Pub/Sub topic, watch test, and one-time callback lifecycle controls
- `cards/capabilityOverviewModel.ts` — stable capability state/mode to Settings status-label projection
- `cards/coreCredentialModel.ts` — redacted source, pending-state, timestamp, and stable-error presentation helpers

### Shared
- `shared/ProviderModelSelect.tsx` — dual select for LLM provider + model

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Cards share one shape: title + icon + description + content; local form state synced via patch().
- Provider/model pairs degrade through fallback chains when an API key is unconfigured.

## Related

- `server/routes/settings.ts` — persistence endpoint; schemas in `server/platform/settings-schemas.ts`
