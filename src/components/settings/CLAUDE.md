# Settings Map

The settings surface: tabbed sections composed of cards covering accounts, integrations (Gmail/iCloud/Todoist/Discord/Actual), AI model selection, bill-pay mappings, triage automation, and security. Entry points are the `sections/` components (one per tab) with `settings-core.ts` owning tab routing and `settings-ui.tsx` the shared layout primitives.

## Files

### Chrome + core
- `SettingsChrome.tsx` — loading skeletons during settings fetch/transition
- `settings-core.ts` — button class constants, tab definitions, tab-from-URL routing
- `settings-ui.tsx` — StatusPill, SaveStatus, SettingsCard, SkeletonCard, SettingsLayout
- `settingsTypes.ts` — shared Settings card state, patch, and account prop contracts
- `AccountsList.tsx` — draggable, editable account rows with icon/color pickers

### Sections (one per tab)
- `sections/AccountsSettingsSection.tsx` — thin shell composing the ConnectedAccounts / Todoist / DiscordReminders / WeatherLocation cards
- `sections/ActualBudgetSettingsSection.tsx` — Actual connection plus bill-pay mapping cards
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
- `cards/ConnectedAccountsCard.tsx` — Gmail OAuth + iCloud IMAP account add/remove; feeds the email snapshot pipeline
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
