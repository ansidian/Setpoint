import type { ActualAccount, ActualMetadata, ActualSchedule, ActualScheduleCondition } from "../../shared/types/actual.ts";
import type { BillCandidate } from "../../shared/types/bills.ts";
import type { TargetEvidence, TargetValue } from "./financialEmailImportedHistory.ts";
import type { FinancialTargetBundleRanker } from "./financialEmailTargetInference.ts";
import { hasVerbatimFinancialEvidence } from "./financialEmailClassificationPolicy.ts";

type AccountRole = "account" | "from_account" | "to_account";

function groundedAccountHint(candidate: BillCandidate, role: AccountRole, content: string): string | null {
  const hint = candidate[`${role}_hint`];
  return typeof hint === "string" && Number(candidate[`${role}_hint_confidence`]) >= 0.8
    && hasVerbatimFinancialEvidence(content, hint) ? hint.trim() : null;
}

/** An explicit funding/destination fact can identify any represented account. */
export function namedAccountEvidence(candidate: BillCandidate, metadata: ActualMetadata, role: AccountRole, content: string): TargetEvidence[] {
  const hint = groundedAccountHint(candidate, role, content);
  if (!hint) return [];
  const product = accountProduct(hint);
  const suffix = accountSuffix(hint);
  return metadata.accounts.filter((account) => !account.closed
    && (accountProduct(account.name) === product || (suffix && accountSuffix(account.name) === suffix)))
    .map((account) => ({ id: account.id, label: account.name, tier: 1, decisive: true,
      provenance: { source: "actual_metadata", confidence: "exact", reason: `explicit_${role}_identity`, evidence: hint } }));
}

export async function rankedAccountEvidence(candidate: BillCandidate, metadata: ActualMetadata, role: AccountRole,
  content: string, rank?: FinancialTargetBundleRanker): Promise<TargetEvidence[]> {
  if (!rank || !groundedAccountHint(candidate, role, content)) return [];
  const accounts = metadata.accounts.filter((account) => !account.closed);
  if (!accounts.length || accounts.length > 32) return [];
  const meaning = role === "from_account" ? "Account the completed payment left"
    : role === "to_account" ? "Account the completed payment entered" : "Account used for this transaction";
  const options = accounts.map((account, index) => ({ key: `${role}_${index + 1}`, description: `${meaning}: ${account.name}` }));
  const ranking = await rank({ candidate, options }).catch(() => null);
  const index = options.findIndex((option) => option.key === ranking?.key);
  if (ranking?.status !== "selected" || Number(ranking.confidence) < 0.8 || index < 0
    || !hasVerbatimFinancialEvidence(content, ranking.evidence)) return [];
  const account = accounts[index]!;
  return [{ id: account.id, label: account.name, tier: 2, decisive: true,
    provenance: { source: "model_ranking", confidence: "high", reason: `explicit_${role}_ranking`, evidence: ranking.evidence } }];
}

function accountProduct(value: string): string {
  return value.replace(/[®™]/g, "")
    .normalize("NFKC").toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/(?:\s|[-.])+\d{4}\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function accountSuffix(name: string): string | null {
  return name.match(/(?:^|\D)(\d{4})\)?\s*$/)?.[1] || null;
}

export function creditCompatible(account: ActualAccount): boolean {
  return !["checking", "savings", "cash"].includes(String(account.type || "").toLowerCase());
}

export function namedCreditAccountEvidence(candidate: BillCandidate, metadata: ActualMetadata): TargetEvidence[] {
  const hint = String(candidate.account_hint || "").trim();
  if (!hint || !(Number(candidate.account_hint_confidence) >= 0.8)) return [];
  const product = accountProduct(hint);
  if (!product) return [];
  const matching = metadata.accounts.filter((account) => creditCompatible(account) && accountProduct(account.name) === product);
  const suffix = trustedAccountSuffix(candidate);
  const supported = suffix ? matching.filter((account) => accountSuffix(account.name) === suffix) : [];
  return (supported.length ? supported : matching)
    .map((account) => ({
      id: account.id,
      label: account.name,
      tier: 2,
      decisive: true,
      provenance: {
        source: "actual_metadata",
        confidence: "exact",
        reason: "exact_account_product",
        evidence: hint,
      },
    }));
}

export function trustedAccountSuffix(candidate: BillCandidate): string | null {
  const suffix = String(candidate.account_last4 || "").replace(/\D/g, "");
  return suffix.length === 4
    && String(candidate.account_last4_evidence || "").replace(/\D/g, "").includes(suffix)
    && Number(candidate.account_last4_confidence) >= 0.8 ? suffix : null;
}

interface TransferSchedule {
  type?: string;
  conditions?: ActualScheduleCondition[];
  transferAccountId?: string | null;
}

export function scheduleAccountId(schedule: TransferSchedule): string | null {
  const value = schedule.conditions?.find((condition) => ["account", "acct"].includes(String(condition.field)))?.value;
  return typeof value === "string" ? value : null;
}

export function transferScheduleTopology(schedule: TransferSchedule): { fromAccountId: string; toAccountId: string } | null {
  const account = scheduleAccountId(schedule);
  const other = schedule.transferAccountId;
  if (schedule.type !== "transfer" || !account || !other || account === other) return null;
  const condition = schedule.conditions?.find((item) => item.field === "amount");
  if (!condition || !["is", "isapprox", "isbetween"].includes(String(condition.op))) return null;
  const value = condition.value;
  if (condition.op === "isbetween") {
    if (!value || typeof value !== "object" || typeof value.num1 !== "number" || typeof value.num2 !== "number") return null;
  } else if (typeof value !== "number") return null;
  const amounts = typeof value === "object" && value !== null ? [value.num1, value.num2] : [value];
  const signs = amounts.map((amount) => typeof amount === "number" && Number.isFinite(amount) ? Math.sign(amount) : 0);
  if (signs.every((sign) => sign === 1)) return { fromAccountId: other, toAccountId: account };
  if (signs.every((sign) => sign === -1)) return { fromAccountId: account, toAccountId: other };
  return null;
}

export function financialScheduleEvidence(
  schedules: ActualSchedule[], metadata: ActualMetadata,
  field: "schedule" | "account" | "payee" | "from_account" | "to_account",
): TargetEvidence[] {
  return schedules.flatMap((schedule) => {
    let value: TargetValue | null = null;
    if (field === "schedule") value = schedule.name ? { id: schedule.id || null, label: schedule.name } : null;
    if (["account", "from_account", "to_account"].includes(field)) {
      const topology = transferScheduleTopology(schedule);
      const id = field === "account" ? scheduleAccountId(schedule)
        : field === "from_account" ? topology?.fromAccountId : topology?.toAccountId;
      const account = metadata.accounts.find((item) => item.id === id);
      value = account ? { id: account.id, label: account.name } : null;
    }
    if (field === "payee") {
      const id = schedule.conditions?.find((item) => ["payee", "description"].includes(String(item.field)))?.value;
      const payee = metadata.payees.find((item) => item.id === id);
      value = payee ? { id: payee.id, label: payee.name } : null;
    }
    return value ? [{ ...value, tier: 2 as const, decisive: true,
      provenance: { source: "actual_metadata" as const, confidence: "exact" as const,
        reason: "exact_schedule_identity", evidence: schedule.name || undefined } }] : [];
  });
}

export async function rankedCreditAccountEvidence(candidate: BillCandidate, metadata: ActualMetadata, rank: FinancialTargetBundleRanker): Promise<TargetEvidence[]> {
  const accounts = metadata.accounts.filter(creditCompatible);
  if (!accounts.length || accounts.length > 32) return [];
  const options = accounts.map((account, index) => ({ key: `account_${index + 1}`, description: `Credit-card payment destination: ${account.name}` }));
  const ranking = await rank({ candidate, options });
  const index = options.findIndex((option) => option.key === ranking.key);
  if (ranking.status !== "selected" || index < 0) return [];
  const account = accounts[index]!;
  return [{ id: account.id, label: account.name, tier: 5, decisive: false,
    provenance: { source: "model_ranking", confidence: "high", reason: "constrained_credit_account_ranking", evidence: ranking.evidence } }];
}
