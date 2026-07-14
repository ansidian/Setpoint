const TIMING_PREFIX = "[EA Timing]";

function cleanTimingFields(fields) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [
        key,
        key === "ms" && Number.isFinite(value) ? Math.round(value) : value,
      ]),
  );
}

export function formatTimingLog(fields) {
  return `${TIMING_PREFIX} ${JSON.stringify(cleanTimingFields(fields))}`;
}

export function logTiming(fields, logger = console.log) {
  logger(formatTimingLog(fields));
}
