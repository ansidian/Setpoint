const TIMING_PREFIX = "[EA Timing]";

export type TimingFields = Readonly<Record<string, unknown>>;
export type TimingLogger = (message: string) => void;

function cleanTimingFields(fields: TimingFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [
        key,
        key === "ms" && typeof value === "number" && Number.isFinite(value) ? Math.round(value) : value,
      ]),
  );
}

export function formatTimingLog(fields: TimingFields): string {
  return `${TIMING_PREFIX} ${JSON.stringify(cleanTimingFields(fields))}`;
}

export function logTiming(fields: TimingFields, logger: TimingLogger = console.log): void {
  logger(formatTimingLog(fields));
}
