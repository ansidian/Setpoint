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

// Provider model ids stay compact in analytics rows; the exact id remains in the
// row title for precision.
export function formatModelName(id: unknown): string {
  const model = String(id || "");
  const claude = model.match(/claude-(haiku|sonnet|opus)-(\d+)-(\d+)/);
  if (claude) return `${claude[1]?.[0]?.toUpperCase()}${claude[1]?.slice(1)} ${claude[2]}.${claude[3]}`;
  const gpt = model.match(/^gpt-(\d+)[.-](\d+)(?:-([a-z0-9-]+))?/i);
  if (gpt) {
    const suffix = gpt[3]
      ? ` ${gpt[3].split("-").map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`).join(" ")}`
      : "";
    return `GPT-${gpt[1]}.${gpt[2]}${suffix}`;
  }
  return model || "unknown";
}
