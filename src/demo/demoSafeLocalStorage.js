import { isDemoMode } from "./config.js";

export function readDemoSafeLocalStorage(key) {
  if (isDemoMode()) return null;
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeDemoSafeLocalStorage(key, value) {
  if (isDemoMode()) return;
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Ignore unavailable storage (private mode, quota, or restricted contexts).
  }
}
