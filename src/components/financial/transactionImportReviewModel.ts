import type { TransactionImportSource } from "../../../shared/types/transaction-imports";

export function formatImportAmount(amountCents: number | null): string {
  if (!Number.isSafeInteger(amountCents)) return "Amount unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((amountCents || 0) / 100);
}

export function transactionImportSourceLabel(source: TransactionImportSource): string {
  if (source === "amazon") return "Amazon";
  if (source === "paypal") return "PayPal";
  return "Financial email";
}
