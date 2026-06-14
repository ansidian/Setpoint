# Server Middleware Map

Cross-cutting Express request-pipeline middleware composed in `server/index.js`: async-rejection forwarding, session/API-token auth guards, and dependency-free gzip. These are pipeline helpers — they hold no domain logic and must not import from a domain.

## Files

- `async-handler.js` — `asyncHandler` / `wrapRouterAsync` forward async route rejections to the terminal `errorHandler` (also here, a 4-arg error middleware honoring `err.status` and the `headersSent` guard). Express 4 does not catch async rejections, so an unwrapped rejecting handler hangs the request (P1-12).
- `auth.js` — session + API-token authentication: `validateSession` / `createSession` / `deleteSession` (hashed cookie tokens, 30-day TTL, 30s positive-validation cache), `validateBearer` (scoped `ea_api_tokens`), and the route guards `requireCookieSession`, `requireApiTokenScope`, `requireCookieSessionOrApiTokenScope`.
- `compression.js` — `responseCompression`, a streaming-safe gzip built on Node `zlib` (no dependency). Decides buffer-vs-passthrough on the first write/end by Content-Type, and deliberately never buffers `text/event-stream` (Alfred + dashboard SSE).

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- `wrapRouterAsync` wraps only verb handlers, NOT `router.use()` — async middleware mounted via `use` (e.g. `requireCookieSession`) must guard itself with try/catch and forward faults via `next(err)` (P1-12).
- Auth guards return 401/403 for auth failures but forward DB/transport faults to `errorHandler` (a 500) rather than rejecting and hanging.
- The session-validation cache stores only positive, unexpired results; negatives and expirations always fall through to the DB. It is invalidated on logout and bounded by the 30s TTL.

## Related

- `server/index.js` — composition root that mounts these (compression, auth guards, terminal `errorHandler`).
- `server/db/connection.js` — Turso/SQLite client used by `auth.js` for session/token validation.
