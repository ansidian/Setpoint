export function normalizeEmailDateUtc(value: unknown): string {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}
