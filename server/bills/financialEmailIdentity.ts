import { createHash } from "crypto";
import type { BillCandidate, BillTransactionImportEvidence, FinancialEmailIdentity, FinancialEmailInput } from "../../shared/types/bills.ts";
import { selectSemanticBillAmount } from "./billSemanticAmountPolicy.ts";

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : String(value ?? "").trim().toLowerCase();
}

export function financialEmailIdentity(userId: string, input: FinancialEmailInput): FinancialEmailIdentity {
  const providerMessageId = normalized(input.providerMessageId);
  if (!providerMessageId) return { version: 1, status: "missing", key: null };
  const material = [
    "financial-email-v1",
    normalized(userId),
    normalized(input.sourceIdentity?.provider),
    normalized(input.sourceIdentity?.accountId),
    providerMessageId,
    normalized(input.candidateIdentityHint),
  ].join("\u001f");
  return {
    version: 1,
    status: "resolved",
    key: `financial-email:v1:${createHash("sha256").update(material).digest("hex")}`,
  };
}

export function financialEmailProviderTransactionIdentity(
  userId: string,
  input: FinancialEmailInput,
  candidate: BillCandidate,
): BillTransactionImportEvidence | null {
  const reference = String(candidate.provider_reference || "").trim();
  const referenceEvidence = String(candidate.provider_reference_evidence || "");
  if (!reference || Number(candidate.provider_reference_confidence) < 0.8
    || !normalized(referenceEvidence).includes(normalized(reference))) return null;
  const provider = normalized(
    input.sourceIdentity?.senderAddress
      || input.sourceIdentity?.provider
      || input.email?.from_address
      || input.email?.from,
  );
  if (!provider) return null;
  const material = ["financial-provider-transaction-v1", normalized(userId), provider, normalized(reference)].join("\u001f");
  return {
    source: "generic",
    parserVersion: "financial-email-semantics-v2",
    executionOwner: "planner",
    externalId: reference,
    importedId: `financial-email:provider:v1:${createHash("sha256").update(material).digest("hex")}`,
    amountCents: 0,
    currency: candidate.currency || null,
  };
}

export function withFinancialEmailProviderTransactionIdentity(
  userId: string,
  input: FinancialEmailInput,
  candidate: BillCandidate,
): BillCandidate {
  const transaction = financialEmailProviderTransactionIdentity(userId, input, candidate);
  const amount = selectSemanticBillAmount(candidate)?.amount;
  if (!transaction || !Number.isFinite(amount)) return candidate;
  const income = candidate.type === "income" || ["refund", "reward"].includes(String(candidate.event_kind || ""));
  return {
    ...candidate,
    transaction_import: {
      ...transaction,
      amountCents: (income ? 1 : -1) * Math.round(Number(amount) * 100),
    },
  };
}
