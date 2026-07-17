// @actual-app/crdt keeps a single mutable module-global HLC `clock`
// (setClock/getClock/Timestamp.send all read+mutate it). Two unrelated paths
// drive that global:
//
//   1. the lightweight bill-write path  (actual-lightweight-writes.ts)
//   2. the local-metadata refresh/sync path (actual-local-metadata.ts)
//
// Each does loadClock -> mint/apply timestamps -> persist merkle/messages_clock,
// with awaits (including a network sync) in between. If the two interleave, one
// path's loadClock overwrites the other's in-flight clock and the persisted
// merkle/messages_clock corrupts or messages mis-timestamp (P1-4). This mutex
// makes each path's clock read-modify-write atomic against the other.
//
// This is a single-user / single-Actual-budget app (EA_USER_ID is load-bearing,
// no multi-tenancy), so ONE process-wide mutex correctly serializes every clock
// mutation for the one budget. If multi-budget is ever introduced, convert this
// to a keyed mutex (Map<key, Promise>) keyed by config.syncId — which equals
// metadata.groupId and is available on BOTH paths.
let clockLock = Promise.resolve();

export function withActualClockLock<T>(fn: () => T | Promise<T>): Promise<T> {
  // Run fn after the previous holder settles (success OR failure). `result` is
  // the caller's real promise; the stored tail swallows rejections so one failed
  // critical section never wedges the chain for the next caller.
  const result = clockLock.then(fn, fn);
  clockLock = result.then(() => {}, () => {});
  return result;
}
