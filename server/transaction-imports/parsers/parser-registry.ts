import type { TransactionEmailInput, TransactionParseResult } from "../transaction-import-types.ts";
import { matchesAmazonFamily, parseAmazonEmail } from "./amazon.ts";
import { matchesPayPalFamily, parsePayPalEmail } from "./paypal.ts";
import { normalizedMailbox } from "./parser-utils.ts";

export function isTransactionParserOwnedEmail(email: Pick<TransactionEmailInput, "from" | "subject" | "text">): boolean {
  const sender = normalizedMailbox(email.from);
  return sender === "auto-confirm@amazon.com" && matchesAmazonFamily(email)
    || sender === "service@paypal.com" && matchesPayPalFamily(email);
}

export function parseTransactionEmail(email: TransactionEmailInput): TransactionParseResult {
  if (matchesAmazonFamily(email)) return parseAmazonEmail(email);
  if (matchesPayPalFamily(email)) return parsePayPalEmail(email);
  return { kind: "unmatched" };
}
