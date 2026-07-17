# Server Platform Map

Cross-domain infrastructure: config, account canonicalization, settings validation, secret encryption, and small external clients. Domain directories may import from here; platform modules must never import from a domain.

## Files

- `config-service.ts` — loads canonical accounts and settings from `ea_accounts`/`ea_settings`
- `account-canonical.ts` — dedupes configured accounts, resolves canonical Gmail account
- `settings-schemas.ts` — write-boundary validation for `ea_settings` JSON blobs
- `encryption.ts` — secret encrypt/decrypt for stored credentials
- `google-places.ts` — Google Places autocomplete/details client with radius biasing
- `weather.ts` — Pirate Weather fetch and condition → lucide icon mapping
- `fetch-with-timeout.ts` — shared timeout helper for external provider fetches and non-fetch async operations
- `provider-reauth.ts` — OAuth reconnect signaling: check for `invalid_grant` errors, flag/clear needs-reauth on accounts and Todoist

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- Dependency direction is one-way: `platform` may import `server/db/`, never `server/<domain>/`.
- The cron composition root lives at `server/scheduler.ts`, not here — it imports from every domain.

## Related

- `server/routes/settings.js` — main consumer of settings/encryption helpers (converted in child 07)
