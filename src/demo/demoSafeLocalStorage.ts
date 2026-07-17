import { isDemoMode } from "./config.ts";

export function readDemoSafeLocalStorage(key: string): string | null {
  if (isDemoMode()) return null;
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeDemoSafeLocalStorage(key: string, value: string): void {
  if (isDemoMode()) return;
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Ignore unavailable storage (private mode, quota, or restricted contexts).
  }
}
