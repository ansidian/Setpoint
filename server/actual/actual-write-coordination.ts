import { AsyncLocalStorage } from 'node:async_hooks';
import db from '../db/connection.ts';

let tail: Promise<unknown> = Promise.resolve();
const scope = new AsyncLocalStorage<boolean>();
/** Parent-process serialization also covers lightweight writes. Active journals survive restarts. */
export function coordinateActualWrite<T>(work: () => Promise<T>): Promise<T> {
  if (scope.getStore()) return work();
  const result = tail.then(() => scope.run(true, work));
  tail = result.catch(() => {});
  return result;
}
export async function guardOrdinaryActualWrite(userId: string): Promise<void> {
  const result = await db.execute({ sql: "SELECT 1 AS guarded FROM ea_financial_corrections WHERE user_id=? AND state IN ('applying','recovering','attention') LIMIT 1", args: [userId] });
  if (result.rows.some(row => row.guarded === 1)) throw Object.assign(new Error('An Actual correction is applying or requires recovery. Finish it before another Setpoint write.'), { status: 409 });
}

export async function guardCorrectedOriginalIdentity(userId: string, identities: string[]): Promise<void> {
  for (const identity of identities) {
    const result = await db.execute({ sql: `SELECT 1 AS guarded FROM ea_financial_corrected_sources
      WHERE user_id=? AND (original_imported_id=? OR (owner='event' AND 'financial-event:' || record_id=?)) LIMIT 1`, args: [userId, identity, identity] });
    if (result.rows.some(row => row.guarded === 1)) throw Object.assign(new Error('This original source has an explicit correction and cannot be replayed.'), { status: 409 });
  }
}
