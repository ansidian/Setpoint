import type { TransactionEmailInput, TransactionParseResult } from "../transaction-import-types.ts";
import { matchesAmazonFamily, parseAmazonEmail } from "./amazon.ts";
import { matchesPayPalFamily, parsePayPalEmail } from "./paypal.ts";

export function parseTransactionEmail(email: TransactionEmailInput): TransactionParseResult {
  if (matchesAmazonFamily(email)) return parseAmazonEmail(email);
  if (matchesPayPalFamily(email)) return parsePayPalEmail(email);
  return { kind: "unmatched" };
}
