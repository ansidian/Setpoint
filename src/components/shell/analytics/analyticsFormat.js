// Shared formatters for the AI Analytics hub sections. Kept in a plain .js module
// (separate from analyticsPrimitives.jsx) so the component file only exports
// components — otherwise react-refresh/only-export-components breaks fast refresh
// for every consumer of the primitives.

export function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function formatPercent(value) {
  return `${(numberValue(value) * 100).toFixed(1)}%`;
}

export function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numberValue(value)).toLowerCase();
}

export function formatUsdEstimate(value) {
  const number = numberValue(value);
  if (number > 0 && number < 0.0001) return "<$0.0001";
  if (number > 0 && number < 0.01) return `$${number.toFixed(4)}`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(number);
}
