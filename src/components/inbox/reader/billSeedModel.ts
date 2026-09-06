// Historical form seed for the shared Actual record workspace.
import type { BillCandidate } from "../../../../shared/types/bills";
import type { BillResolutionState } from "./readerTypes";

// The bill object the drawer seeds from: the resolver's resolved bill if present,
// else the email's own extracted bill, else an empty expense placeholder.
export function resolveBillSeed(
  billResolution: Pick<BillResolutionState, "resolvedBill"> | null | undefined,
  extractedBill: BillCandidate | null | undefined,
): BillCandidate {
  return (
    billResolution?.resolvedBill ||
    extractedBill || {
      payee: "",
      amount: null,
      due_date: "",
      type: "expense",
    }
  );
}
