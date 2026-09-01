import { createHash } from "crypto";
import type { FinancialEmailIdentity, FinancialEmailInput } from "../../shared/types/bills.ts";

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
