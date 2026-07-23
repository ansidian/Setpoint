import type { NormalizedFetchedEmail } from "../../shared/types/email.ts";
import type { TransactionEmailInput } from "./transaction-import-types.ts";
import { transactionImportService } from "./transaction-import-service.ts";
import { requestTransactionImportDrain } from "./transaction-import-runtime.ts";

export function projectGmailArrivalEmail(accountId: string, email: NormalizedFetchedEmail): TransactionEmailInput {
  const prefix = `gmail-${accountId}-`;
  const gmailMessageId = email.uid.startsWith(prefix) ? email.uid.slice(prefix.length) : email.uid;
  return {
    uid: email.uid,
    gmailAccountId: accountId,
    gmailMessageId,
    internetMessageId: email.message_id ?? null,
    from: email.from,
    subject: email.subject,
    date: email.date,
    html: null,
    text: email.body_text,
  };
}

export async function ingestGmailTransactionArrivals(
  userId: string,
  accountId: string,
  emails: NormalizedFetchedEmail[],
): Promise<{ queued: number }> {
  const projected = emails.map((email) => projectGmailArrivalEmail(accountId, email));
  const result = await transactionImportService.ingestArrivals(userId, projected);
  if (result.queued) requestTransactionImportDrain();
  return { queued: result.queued };
}
