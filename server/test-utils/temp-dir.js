// Shared test-only helper for removing a temp directory that may hold a
// just-used libsql/sqlite db file.
//
// On Windows the libsql `file:` driver keeps the db file locked for several
// seconds after the client's close() resolves -- and effectively forever for an
// interactive transaction("write"), whose native handle close() does not
// reclaim. Deleting the dir then throws EBUSY/EPERM (POSIX has no such race --
// it permits unlinking open files -- which is why Linux/CI is unaffected).
//
// Cleanup is therefore BEST-EFFORT: try a few quick times (so Linux/CI deletes
// immediately and the common Windows transient clears), and if the lock is still
// held, leave the dir for the OS temp sweeper rather than throwing or hanging the
// test teardown. A longer retry would only collide with the runner's hook timeout
// and cannot win the transaction case at all.
import { rm } from "fs/promises";

const TRANSIENT = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

export async function removeTempDir(dir) {
  if (!dir) return;
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (err) {
    if (!TRANSIENT.has(err?.code)) throw err;
  }
}
