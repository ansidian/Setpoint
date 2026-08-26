let fallbackIdCounter = 0;

function lowercaseHexId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid.replace(/-/g, "").toLowerCase();
  fallbackIdCounter += 1;
  const time = Date.now().toString(16).padStart(12, "0");
  const counter = fallbackIdCounter.toString(16).padStart(8, "0");
  const random = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${time}${counter}${random}`;
}

/** Google accepts caller-provided lowercase base32hex ids; lowercase hex is a valid subset. */
export function createCalendarProviderEventId() {
  return lowercaseHexId();
}

export function createCalendarMutationId() {
  return lowercaseHexId();
}
