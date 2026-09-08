# Server Authentication Map

Singleton-owner setup, password and passkey authentication, recovery, and session security support. HTTP authentication guards belong to `server/middleware/`; this directory owns the supporting policies, stores, and owner lifecycle.

## Files

- `passkey-store.ts` — CRUD for stored passkey credentials
- `auth-mode.ts` — explicit password-or-passkey vs. strict password-plus-passkey resolution
- `recovery-code-store.ts` — high-entropy recovery-code generation, hashing, replacement, status, and atomic consumption
- `pending-auth-store.ts` — generation-bound short-lived pending-auth issuance plus atomic consumption (WebAuthn ceremony handoff)
- `session-cookie.ts` — centralized secure session-cookie issue/clear behavior around generation-conditional session creation
- `security-transition.ts` — transactional owner-generation compare-and-swap for credential mutations plus session/pending/challenge revocation
- `password-policy.ts` — existing-password verification bounds and the minimum policy for every newly chosen password
- `password-login-throttle.ts` — atomic durable singleton-owner password attempt budget shared across IPs and processes
- `setup-token.ts` — constant-time validation of the out-of-band first-claim deployment secret
- `owner-store.ts` — singleton owner persistence and atomic claim invariant
- `owner-bootstrap.ts` — startup resolution and fail-closed legacy env import
- `owner-claim-service.ts` — first-visitor password hashing and owner claim orchestration
- `owner-context.ts` — process-local claimed-owner context and runtime activation notifications
- `owner-runtime.ts` — one-shot gate that admits background work only after owner claim
- `webauthn-challenge-store.ts` — generation-bound short-lived WebAuthn challenge issuance and atomic consumption
- `webauthn-config.ts` — relying-party (RP) id/name/origin resolution for dev vs. production
- `webauthn-service.ts` — registration/authentication option + verification flows (via `@simplewebauthn/server`)

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Authentication modules are one-way dependencies for domain code. Nothing under `server/auth/` should import a domain; preserve the boundary documented in the [server root map](../CLAUDE.md).

## Related

- [Middleware map](../middleware/CLAUDE.md) — request authentication guards and session validation.
- [Server root map](../CLAUDE.md) — startup composition, credential configuration and database support.
