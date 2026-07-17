# Server Middleware Map

Cross-cutting Express request-pipeline middleware composed in `server/index.ts`: async-rejection forwarding, session/API-token auth guards, and dependency-free gzip. These are pipeline helpers — they hold no domain logic and must not import from a domain.

## Files

- `async-handler.ts` — `asyncHandler` / `wrapRouterAsync` forward async route rejections to the terminal `errorHandler` (also here, a 4-arg error middleware honoring `err.status` and the `headersSent` guard). Express 4 does not catch async rejections, so an unwrapped rejecting handler hangs the request (P1-12).
- `auth.ts` — session + API-token authentication: hashed cookie tokens, recent-auth timestamps and guard, 30-day TTL, 30s positive-validation cache, scoped bearer tokens, and cookie/API-token route guards.
- `compression.ts` — `responseCompression`, a streaming-safe gzip built on Node `zlib` (no dependency). Decides buffer-vs-passthrough on the first write/end by Content-Type, and deliberately never buffers `text/event-stream` (Alfred + dashboard SSE).
- `rate-limits.ts` — per-route spend guards for LLM/paid-API routes (bills/extract, alfred run, email-search, places); each limiter is exported as both a `makeXLimiter()` factory (fresh, test-isolated instance) and a singleton built from it (used by real route wiring), since `express-rate-limit` tracks counts per-instance.
- `owner-gate.ts` — blocks all non-setup APIs until the singleton owner has been claimed; returns a fixed setup-required response.

(Tests are not listed: `X.test.ts(x)` covers `X` by convention.)

## Local patterns

- `wrapRouterAsync` wraps only verb handlers, NOT `router.use()` — async middleware mounted via `use` (e.g. `requireCookieSession`) must guard itself with try/catch and forward faults via `next(err)` (P1-12).
- Auth guards return 401/403 for auth failures but forward DB/transport faults to `errorHandler` (a 500) rather than rejecting and hanging.
- The session-validation cache stores only positive, unexpired results; negatives and expirations always fall through to the DB. It is invalidated on logout and bounded by the 30s TTL.

## Related

- `server/index.ts` — composition root that mounts these (compression, auth guards, terminal `errorHandler`).
- `server/db/connection.ts` — Turso/SQLite client used by `auth.ts` for session/token validation.
