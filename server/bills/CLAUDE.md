# Server Bills Map

The Actual schedule mirror that feeds the read-only Finances page, plus the Actual connection/cache facade. Nothing here writes to Actual.

## Files

- `bills-service.ts` — public facade: Actual connection save/remove/test, local cache hydration and status, and mirror re-exports
- `bills-mirror-sync.ts` — syncs Actual schedule occurrences into `ea_bills_mirror_*`, runs five-minute maintenance with one-minute failure retry; thin IO + scheduler + refresh-orchestration over billsMirrorModel.ts
- `billsMirrorModel.ts` — pure derivation: date/range math, mirror row<->object projections, upsert arg builders, and the maintenance-due predicate

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- The mirror is a read model of Actual. The SDK worker in `server/actual/` alone syncs the local budget; this domain only projects it.

## Related

- `server/actual/` — SDK worker and local budget readers this domain drives
- `server/routes/briefing/actual-connection.ts` — HTTP surface
- `server/finances/` — the Finances page composition that reads the mirror
