export const FINANCE_SOURCE_COLORS = Object.freeze({
  income: "#89dceb",
  outflow: "#b4befe",
  transfer: "#89b4fa",
});

export function transactionDirectionColor(direction) {
  return direction === "income"
    ? FINANCE_SOURCE_COLORS.income
    : FINANCE_SOURCE_COLORS.outflow;
}
