# Settings Map

The settings surface: a Connections directory plus Automation, Finance, and System sections. Connections owns external-service setup and health; the feature tabs retain behavior and owner-security controls. `settings-core.ts` owns tab routing and `settings-ui.tsx` owns shared layout primitives.

## Files

### Chrome + core
- `SettingsChrome.tsx` — loading skeletons during settings fetch/transition
- `settings-core.ts` — button class constants, tab definitions, tab-from-URL routing
- `settings-ui.tsx` — StatusPill, SaveStatus, SettingsCard, SkeletonCard, SettingsLayout
- `settingsTypes.ts` — shared Settings card state, patch, and account prop contracts
- `connectionModel.ts` — fixed connection definitions plus pure service-level status projection
- `connectionDirectoryModel.ts` — canonical/legacy connection hash parsing plus directory summary/action projection
- `ConnectionsDirectory.tsx` — grouped, one-open disclosure directory synchronized to the URL hash
- `ConnectionPanelContent.tsx` — service-to-existing-control ownership mapping and expanded state evidence
- `ConnectionDependencyPrompt.tsx` — concise setup/repair prerequisite prompt with canonical Connections deep links
- `featureDependencyModel.ts` — pure Automation/Finance visibility and AI provider-selection projection
- `AccountsList.tsx` — draggable, editable provider-filtered account rows with icon/color pickers

### Sections (one per tab)
- `sections/ConnectionsSettingsSection.tsx` — directory shell that binds projected service rows to connection panels
- `sections/ActualBudgetSettingsSection.tsx` — Finance behavior: bill-pay mappings, mapping tests, and utility links
- `sections/EmailAutomationSettingsSection.tsx` — triage mode, sounds, AI models, extraction, lookback
- `sections/SystemSettingsSection.tsx` — passkeys and API tokens

### Cards: AI + automation
- `cards/EmailAiModelCard.tsx` — email triage LLM provider/model selection with fallbacks
- `cards/EmailTriageModeCard.tsx` — triage automation toggle (auto/real/no-model/paused) with cache stats
- `cards/BillExtractionAiCard.tsx` — bill extraction model choice, separate from triage model
- `cards/TriageSoundSettingsCard.tsx` — sound lanes, volume, per-trigger playback
- `cards/ImportantSendersCard.tsx` — auto-learned and manual important sender lists

### Cards: bill pay mappings
- `cards/BillPayMappingsCard.tsx` — profiles → behaviors → matchers/targets hierarchy editor
- `cards/BillPayMappingInputs.tsx` — ChipEditor, TargetDropdown, MappingSelect, ReorderButtons
- `cards/BillPayMappingTestCard.tsx` — tests mapping resolution against sample email text
- `cards/billPayMappingsModel.ts` — normalizes/validates/mutates the mapping tree
- `cards/UtilityPayLinksCard.tsx` — per-schedule bill-pay website URLs; source for the calendar "Pay Online" button

### Cards: connections + security
- `cards/GoogleWorkspaceAccountsPanel.tsx` — Gmail/Calendar account add, reconnect, edit, reorder, and removal
- `cards/ICloudMailAccountsPanel.tsx` — iCloud IMAP account add, reconnect, edit, reorder, and removal
- `cards/TodoistCard.tsx` — personal-token default plus advanced Todoist app migration, OAuth, callback, and webhook setup
- `cards/DiscordRemindersCard.tsx` — Discord webhook URL + user ID for private reminder delivery, with test-send
- `cards/WeatherLocationCard.tsx` — city geocode → lat/lng patch for dashboard weather snapshots
- `cards/ActualBudgetConnectionCard.tsx` — Actual server URL/auth config, budget cache hydration
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
- `shared/selectMock.test-utils.tsx` — native-`<select>` test double for the Radix Select, used in settings-card tests

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- Cards share one shape: title + icon + description + content; local form state synced via patch().
- Provider/model pairs degrade through fallback chains when an API key is unconfigured.

## Related

- `server/routes/settings.ts` — persistence endpoint; schemas in `server/platform/settings-schemas.ts`
