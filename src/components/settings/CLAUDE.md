# Settings Map

The settings surface: tabbed sections composed of cards covering accounts, integrations (Gmail/iCloud/Todoist/Discord/Actual), AI model selection, bill-pay mappings, triage automation, and security. Entry points are the `sections/` components (one per tab) with `settings-core.js` owning tab routing and `settings-ui.jsx` the shared layout primitives.

## Files

### Chrome + core
- `SettingsChrome.jsx` — loading skeletons during settings fetch/transition
- `settings-core.js` — button class constants, tab definitions, tab-from-URL routing
- `settings-ui.jsx` — StatusPill, SaveStatus, SettingsCard, SkeletonCard, SettingsLayout
- `AccountsList.jsx` — draggable, editable account rows with icon/color pickers

### Sections (one per tab)
- `sections/AccountsSettingsSection.jsx` — thin shell composing the ConnectedAccounts / Todoist / DiscordReminders / WeatherLocation cards
- `sections/ActualBudgetSettingsSection.jsx` — Actual connection plus bill-pay mapping cards
- `sections/EmailAutomationSettingsSection.jsx` — triage mode, sounds, AI models, extraction, lookback
- `sections/SystemSettingsSection.jsx` — passkeys and API tokens

### Cards: AI + automation
- `cards/EmailAiModelCard.jsx` — email triage LLM provider/model selection with fallbacks
- `cards/EmailTriageModeCard.jsx` — triage automation toggle (auto/real/no-model/paused) with cache stats
- `cards/BillExtractionAiCard.jsx` — bill extraction model choice, separate from triage model
- `cards/TriageSoundSettingsCard.jsx` — sound lanes, volume, per-trigger playback
- `cards/ImportantSendersCard.jsx` — auto-learned and manual important sender lists

### Cards: bill pay mappings
- `cards/BillPayMappingsCard.jsx` — profiles → behaviors → matchers/targets hierarchy editor
- `cards/BillPayMappingInputs.jsx` — ChipEditor, TargetDropdown, MappingSelect, ReorderButtons
- `cards/BillPayMappingTestCard.jsx` — tests mapping resolution against sample email text
- `cards/billPayMappingsModel.js` — normalizes/validates/mutates the mapping tree
- `cards/UtilityPayLinksCard.jsx` — per-schedule bill-pay website URLs; source for the calendar "Pay Online" button

### Cards: connections + security
- `cards/ConnectedAccountsCard.jsx` — Gmail OAuth + iCloud IMAP account add/remove; feeds the email snapshot pipeline
- `cards/TodoistCard.jsx` — Todoist API token save/disconnect for email-automation follow-up sync
- `cards/DiscordRemindersCard.jsx` — Discord webhook URL + user ID for private reminder delivery, with test-send
- `cards/WeatherLocationCard.jsx` — city geocode → lat/lng patch for dashboard weather snapshots
- `cards/ActualBudgetConnectionCard.jsx` — Actual server URL/auth config, budget cache hydration
- `cards/BriefingSchedulesCard.jsx` — snapshot window boundaries with FLIP reorder animation
- `cards/ApiTokensCard.jsx` — API token list/create/revoke with scopes and expiry
- `cards/PasskeysCard.jsx` — passkey registration/deletion, enforcement mode

### Shared
- `shared/ProviderModelSelect.jsx` — dual select for LLM provider + model
- `shared/selectMock.test-utils.jsx` — native-`<select>` test double for the Radix Select, used in settings-card tests

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Cards share one shape: title + icon + description + content; local form state synced via patch().
- Provider/model pairs degrade through fallback chains when an API key is unconfigured.

## Related

- `server/routes/settings.js` — persistence endpoint; schemas in `server/platform/settings-schemas.js`
