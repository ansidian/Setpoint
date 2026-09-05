import { requireCompleteEmailEvidence } from "../email/email-evidence.ts";
import type { BillExtractionInput } from "../../shared/types/bills.ts";

// Preserve the whole semantic document: nonfinancial lines can establish
// cancellation, payment purpose, or which table label belongs to an amount.
export function trimBillBody({ subject, from, body }: BillExtractionInput): string {
  const content = requireCompleteEmailEvidence(body);
  return `Subject: ${subject || ""}\nFrom: ${from || ""}\n\n${content}`;
}
