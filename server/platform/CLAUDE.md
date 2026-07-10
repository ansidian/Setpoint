# Server Platform Map

Cross-domain infrastructure: config, account canonicalization, settings validation, secret encryption, and small external clients. Domain directories may import from here; platform modules must never import from a domain.

## Files

- `config-service.js` — loads canonical accounts and settings from `ea_accounts`/`ea_settings`
- `account-canonical.js` — dedupes configured accounts, resolves canonical Gmail account
- `settings-schemas.js` — write-boundary validation for `ea_settings` JSON blobs
- `encryption.js` — secret encrypt/decrypt for stored credentials
- `google-places.js` — Google Places autocomplete/details client with radius biasing
- `weather.js` — Pirate Weather fetch and condition → lucide icon mapping
- `fetch-with-timeout.js` — shared timeout helper for external provider fetches and non-fetch async operations
- `provider-reauth.js` — OAuth reconnect signaling: check for `invalid_grant` errors, flag/clear needs-reauth on accounts and Todoist

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Dependency direction is one-way: `platform` may import `server/db/`, never `server/<domain>/`.
- The cron composition root lives at `server/scheduler.js`, not here — it imports from every domain.

## Related

- `server/routes/settings.js` — main consumer of settings/encryption helpers
