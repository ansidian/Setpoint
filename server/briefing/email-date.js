export function normalizeEmailDateUtc(value) {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}
