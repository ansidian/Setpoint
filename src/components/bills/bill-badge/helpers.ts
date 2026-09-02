import {
  CreditCard,
  FileText,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ActualMetadataEntry } from "../../../lib/actualMetadata";
import type { BillType } from "../../../../shared/types/bills";
import { findBillPaymentAdjustment } from "../../../../shared/billPaymentAdjustments";

export const typeLabels: Record<BillType, { label: string; color: string; Icon: LucideIcon }> = {
  transfer: { label: "Card", color: "#b4befe", Icon: CreditCard },
  bill: { label: "Bill", color: "#a6e3a1", Icon: FileText },
  expense: { label: "Expense", color: "#fab387", Icon: ShoppingCart },
  income: { label: "Income", color: "#89dceb", Icon: Wallet },
};

export const typeHints: Record<BillType, string> = {
  transfer: "Updates upcoming transfer schedule in Actual",
  bill: "Updates upcoming schedule in Actual",
  expense: "Creates one-time transaction",
  income: "Creates one-time transaction",
};

export function detectFee(payeeName: string | null | undefined): { vendor: string; fee: number } | null {
  const adjustment = findBillPaymentAdjustment(payeeName);
  return adjustment
    ? { vendor: adjustment.vendor, fee: adjustment.amountCents / 100 }
    : null;
}

export function formatModelName(model: string | null | undefined): string {
  if (!model) return "Claude";
  const claudeMatch = model.match(/(opus|sonnet|haiku)-(\d+)-?(\d+)?/i);
  if (claudeMatch) {
    const family = claudeMatch[1]!.charAt(0).toUpperCase() + claudeMatch[1]!.slice(1).toLowerCase();
    const version = claudeMatch[3] ? `${claudeMatch[2]}.${claudeMatch[3]}` : claudeMatch[2];
    return `${family} ${version}`;
  }
  const gptMatch = model.match(/^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano|small|micro))?$/i);
  if (gptMatch) {
    const variant = gptMatch[2] ? ` ${gptMatch[2].toLowerCase()}` : "";
    return `GPT-${gptMatch[1]}${variant}`;
  }
  return model;
}

export function scheduleNameFor(accounts: ActualMetadataEntry[], toAccountId: string): string | null {
  const account = accounts.find((entry) => entry.id === toAccountId);
  return account && /\(\d{4}\)/.test(account.name) ? `${account.name} Payment` : null;
}
