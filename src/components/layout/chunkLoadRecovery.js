export const CHUNK_RELOAD_STORAGE_KEY = "setpoint:chunk-reload-attempted-at";
export const CHUNK_RELOAD_COOLDOWN_MS = 5 * 60 * 1000;

function getErrorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return `${error.name || ""} ${error.message || String(error)}`.trim();
}

export function isDynamicImportLoadError(error) {
  const text = getErrorText(error);
  return /ChunkLoadError/i.test(text)
    || /Loading chunk \d+ failed/i.test(text)
    || /Failed to fetch dynamically imported module/i.test(text)
    || /Importing a module script failed/i.test(text)
    || /Expected a JavaScript-or-Wasm module script/i.test(text)
    || /MIME type of "text\/html"/i.test(text);
}

export function readLastChunkReloadAt(storage) {
  try {
    const storedValue = storage?.getItem(CHUNK_RELOAD_STORAGE_KEY);
    if (storedValue === null || storedValue === undefined || storedValue === "") return null;
    const value = Number(storedValue);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastChunkReloadAt(storage, now) {
  try {
    storage?.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
  } catch {
    // Reload recovery should still work when sessionStorage is unavailable.
  }
}
