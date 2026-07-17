import {
  CreditCard,
  FileText,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ActualMetadataEntry } from "../../../lib/actualMetadata";
import type { BillPayMappingOutcome, BillType } from "../../../../shared/types/bills";

type BillPayMappingLabelInput = Omit<Partial<BillPayMappingOutcome>, "status"> & { status?: string };

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

const KNOWN_CC_FEES: Record<string, number> = {
  socalgas: 1.50,
  sce: 1.65,
};

export function detectFee(payeeName: string | null | undefined): { vendor: string; fee: number } | null {
  if (!payeeName) return null;
  const lower = payeeName.toLowerCase();
  for (const [key, fee] of Object.entries(KNOWN_CC_FEES)) {
    if (lower.includes(key)) return { vendor: key, fee };
  }
  return null;
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

export function pickDefaultFromAccount(accounts: ActualMetadataEntry[]): ActualMetadataEntry | null {
  return accounts.find((account) => account.name.toLowerCase().includes("savings"))
    || accounts.find((account) => account.type === "checking" || account.name.toLowerCase().includes("checking"))
    || null;
}

export function scheduleNameFor(accounts: ActualMetadataEntry[], toAccountId: string): string | null {
  const account = accounts.find((entry) => entry.id === toAccountId);
  return account && /\(\d{4}\)/.test(account.name) ? `${account.name} Payment` : null;
}

export function mappingStatusLabel(mapping: BillPayMappingLabelInput | null | undefined, loading: boolean): string | null {
  if (loading) return "Mapping...";
  if (!mapping?.status) return null;
  if (mapping.status === "matched") {
    const parts = ["Mapped:"];
    if (mapping.profileId) parts.push(mapping.profileId);
    if (mapping.behaviorId) parts.push("·", mapping.behaviorId);
    if (mapping.amountSource === "blank") parts.push("·", "amount missing");
    return parts.join(" ");
  }
  if (mapping.status === "identity_only") return "Identity match: choose bill details";
  if (mapping.status === "unmapped") return "Unmapped: review fields manually";
  if (mapping.status === "invalid_target") return "Mapping needs review: Actual target changed";
  if (mapping.status === "incomplete_mapping") return "Mapping incomplete: review fields manually";
  return null;
}
