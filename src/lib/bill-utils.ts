import { todayPacific, toPacificDate } from "./dashboard-helpers";

export function formatAmount(amount?: unknown): string {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(numericAmount);
}

export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  // Anchor "today" and the target to the Pacific day boundary (not the host's
  // local zone), mirroring formatRelativeDate. Noon-anchored so the diff is
  // DST-safe and the local-parse offset cancels in the subtraction. (P3-14 fixed
  // the same boundary disagreement with dayBucket via an equivalent en-CA Pacific
  // YMD diff; resolved onto the shared todayPacific/toPacificDate helpers.)
  const todayMs = new Date(todayPacific() + "T12:00:00").getTime();
  const dueMs = new Date(toPacificDate(dateStr) + "T12:00:00").getTime();
  if (Number.isNaN(dueMs)) return null;
  return Math.round((dueMs - todayMs) / 86400000);
}
