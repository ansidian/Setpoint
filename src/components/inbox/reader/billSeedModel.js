// Pure bill-pay seed derivation + currency formatting, shared by the mobile and
// desktop email readers' bill drawers (the seed fallback chain was duplicated
// verbatim in both; the currency formatter was inline in MobileReader).

// The bill object the drawer seeds from: the resolver's resolved bill if present,
// else the email's own extracted bill, else an empty expense placeholder.
export function resolveBillSeed(billResolution, extractedBill) {
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

// Format a bill amount as USD ("$1,234.50"). Returns "" for null/undefined
// (but formats 0 as "$0.00").
export function formatBillAmount(amount) {
  if (amount == null) return "";
  return `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}
