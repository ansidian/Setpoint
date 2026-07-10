import { readDemoSafeLocalStorage, writeDemoSafeLocalStorage } from "../../demo/demoSafeLocalStorage.js";

// Persistence for the inbox sidebar compact toggle. Default is compact-on.
// Stored as "1" (compact) / "0" (expanded). Any non-"0" value (missing,
// legacy, garbage, or a thrown read) collapses to the compact-on default.
export const SIDEBAR_COMPACT_KEY = "ea:inboxSidebarCompact";

export function readSidebarCompact() {
  try {
    return readDemoSafeLocalStorage(SIDEBAR_COMPACT_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeSidebarCompact(value) {
  try {
    writeDemoSafeLocalStorage(SIDEBAR_COMPACT_KEY, value ? "1" : "0");
  } catch {
    /* ignore storage failures (private mode, quota) */
  }
}
