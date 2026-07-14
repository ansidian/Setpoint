const SQLITE_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return { ms: null, state: "missing" };
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? { ms, state: "valid" } : { ms: null, state: "invalid" };
  }
  const raw = String(value).trim();
  const normalized = SQLITE_UTC_TIMESTAMP.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? { ms, state: "valid" } : { ms: null, state: "invalid" };
}

export function projectEmailArrivalTiming({
  providerPublishedAt,
  historyQueuedAt,
  historyClaimedAt,
  snapshotQueuedAt,
  completedAt,
} = {}) {
  const timestamps = {
    providerPublishedAt: parseTimestamp(providerPublishedAt),
    historyQueuedAt: parseTimestamp(historyQueuedAt),
    historyClaimedAt: parseTimestamp(historyClaimedAt),
    snapshotQueuedAt: parseTimestamp(snapshotQueuedAt),
    completedAt: parseTimestamp(completedAt),
  };
  let clockSkewClamped = false;

  const duration = (startField, endField) => {
    const start = timestamps[startField];
    const end = timestamps[endField];
    if (start.state !== "valid" || end.state !== "valid") return undefined;
    const elapsed = end.ms - start.ms;
    if (elapsed < 0) {
      clockSkewClamped = true;
      return 0;
    }
    return elapsed;
  };

  const result = {
    providerDeliveryMs: duration("providerPublishedAt", "historyQueuedAt"),
    historyQueueWaitMs: duration("historyQueuedAt", "historyClaimedAt"),
    historySyncMs: duration("historyClaimedAt", "completedAt"),
    providerToQueuedMs: duration("providerPublishedAt", "snapshotQueuedAt"),
    snapshotAttachmentMs: duration("snapshotQueuedAt", "completedAt"),
  };
  const invalidFields = Object.entries(timestamps)
    .filter(([, value]) => value.state !== "valid")
    .map(([field, value]) => `${field}:${value.state}`);

  return {
    ...Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)),
    valid: invalidFields.length === 0 && !clockSkewClamped,
    clockSkewClamped,
    invalidFields,
  };
}
