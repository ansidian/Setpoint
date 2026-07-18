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
- `canonical-url.ts` — canonical-origin normalization, legacy import, persistence, WebAuthn derivation, and provider callback URL projection
- `instance-credential-registry.ts` — code allowlist and provider-neutral metadata for deployment-wide credentials
- `instance-credential-store.ts` — encrypted active/pending persistence, disable tombstones, and atomic candidate promotion
- `instance-credential-service.ts` — server-only source resolution, env import, metadata projection, and change subscriptions
- `root-key-health.ts` — non-secret root-key fingerprint and allowlisted ciphertext decryptability audit
- `capability-projection.ts` — pure provider-neutral capability/source/health projection from injected redacted metadata

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- Dependency direction is one-way: `platform` may import `server/db/`, never `server/<domain>/`.
- The cron composition root lives at `server/scheduler.ts`, not here — it imports from every domain.

## Related

- `server/routes/settings.ts` — main consumer of settings/encryption helpers
