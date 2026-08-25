# Tldraw Notes Map

The desktop-only Notes workspace uses one owner-scoped tldraw document with native pages. The server stores a revisioned, gzip-compressed document snapshot in Turso and content-addressed native media on private filesystem storage.

## Files

- `tldraw-document-service.ts` — document validation, gzip persistence, content hashes, and revision compare-and-swap.
- `tldraw-asset-service.ts` — allowlisted media validation and content-addressed filesystem writes/reads.
- `tldraw-license.ts` — signed tldraw license verification against Setpoint's canonical domain plus credential lifecycle integration.

## Boundaries

- The tldraw document snapshot contains document records only. Camera, selection, and session state stay device-local.
- No polling, WebSockets, presence, collaboration, legacy import, or fallback Notes model.
- Client saves are coalesced; the server additionally skips hash-identical writes.
- Asset routes are authenticated and same-origin. Arbitrary attachments are not supported.
- Production requires the encrypted license and necessarily delivers it to the authenticated browser because tldraw validates it client-side. Local development mounts tldraw without a key.
