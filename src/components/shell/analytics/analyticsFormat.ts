// Shared formatters for the AI Analytics hub sections. Kept in a plain .js module
// (separate from analyticsPrimitives) so the component file only exports
// components — otherwise react-refresh/only-export-components breaks fast refresh
// for every consumer of the primitives.

export function numberValue(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function formatPercent(value: unknown): string {
  return `${(numberValue(value) * 100).toFixed(1)}%`;
}

export function formatCompactNumber(value: unknown): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numberValue(value)).toLowerCase();
}

export function formatUsdEstimate(value: unknown): string {
  const number = numberValue(value);
  if (number > 0 && number < 0.0001) return "<$0.0001";
  if (number > 0 && number < 0.01) return `$${number.toFixed(4)}`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(number);
}

// "claude-haiku-4-5-20251001" → "Haiku 4.5". Keeps the exact id in a title attr
// for precision while the row stays scannable.
export function formatModelName(id: unknown): string {
  const match = String(id || "").match(/claude-(haiku|sonnet|opus)-(\d+)-(\d+)/);
  if (match) return `${match[1]?.[0]?.toUpperCase()}${match[1]?.slice(1)} ${match[2]}.${match[3]}`;
  return String(id || "unknown");
}
