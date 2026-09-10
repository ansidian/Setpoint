import type { BillCandidate } from "../../shared/types/bills";

export const DEMO_RECEIPT_UID = "demo-email-market-receipt";
export const DEMO_RECEIPT_SENDER = "receipts@fictional-market.example.test";

export function demoReceiptEmail(day: Date) {
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return {
    itemId: 25, uid: DEMO_RECEIPT_UID, accountId: "demo-icloud", lane: "needs_attention" as const,
    subject: "Your Fictional Market receipt", fromName: "Fictional Market", fromAddress: DEMO_RECEIPT_SENDER,
    summary: "A fictional $46.75 purchase is ready for review in Finances.", action: "Review receipt",
    day, category: "finance", urgency: "low",
    billCandidate: { type: "expense", event_kind: "purchase", payee: "Fictional Market", amount: 46.75,
      due_date: date, currency: "USD" } satisfies BillCandidate,
  };
}

export function demoReceiptBody(date: string): string {
  return `Thank you for shopping at Fictional Market. Your purchase total is $46.75, paid from Demo Checking on ${date}. This is a fictional receipt for the Setpoint demo.`;
}
