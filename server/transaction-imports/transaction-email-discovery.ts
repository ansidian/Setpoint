import {
  fetchGmailTransactionEmailPage,
  type ConfiguredEmailAccount,
  type GmailTransactionSearchPage,
} from "../email/transaction-email-search.ts";
import { TRANSACTION_SOURCES, type TransactionEmailInput, type TransactionSource } from "./transaction-import-types.ts";

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;
const MAX_DATE_SPAN_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_SCAN_MESSAGES = 10_000;
const MAX_SCAN_PAGES = 100;

export interface TransactionEmailSearchOptions {
  source: TransactionSource;
  start: string | number | Date;
  end: string | number | Date;
  pageSize?: number;
  pageToken?: string;
}

export interface TransactionEmailSearchPage {
  emails: TransactionEmailInput[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
  failures: GmailTransactionSearchPage["failures"];
}

export interface TransactionEmailScanResult {
  emails: TransactionEmailInput[];
  failures: GmailTransactionSearchPage["failures"];
  pages: number;
}

export interface TransactionEmailDiscoveryDependencies {
  fetchPage?: typeof fetchGmailTransactionEmailPage;
}

function validateOptions(account: ConfiguredEmailAccount, options: TransactionEmailSearchOptions) {
  if (account.type !== "gmail") throw new Error("Transaction email discovery requires a Gmail account");
  if (!TRANSACTION_SOURCES.includes(options.source)) throw new Error("Unsupported transaction source");
  const startMs = new Date(options.start).getTime();
  const endMs = new Date(options.end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Transaction email discovery requires a valid increasing date range");
  }
  if (endMs - startMs > MAX_DATE_SPAN_MS) throw new Error("Transaction email discovery date range exceeds 366 days");
  const pageSize = options.pageSize ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`Transaction email discovery page size must be ${MIN_PAGE_SIZE}-${MAX_PAGE_SIZE}`);
  }
  return { pageSize };
}

export async function searchTransactionEmails(
  account: ConfiguredEmailAccount,
  options: TransactionEmailSearchOptions,
  dependencies: TransactionEmailDiscoveryDependencies = {},
): Promise<TransactionEmailSearchPage> {
  const { pageSize } = validateOptions(account, options);
  const page = await (dependencies.fetchPage ?? fetchGmailTransactionEmailPage)(account, {
    source: options.source,
    start: options.start,
    end: options.end,
    pageToken: options.pageToken,
    maxResults: pageSize,
  });
  return {
    emails: page.emails.map((email) => ({
      uid: `gmail-${account.id}-${email.gmailMessageId}`,
      gmailAccountId: account.id,
      gmailMessageId: email.gmailMessageId,
      internetMessageId: email.internetMessageId,
      from: email.from,
      subject: email.subject,
      date: email.date,
      html: email.html,
      text: email.text,
      senderAuthentication: email.senderAuthentication,
    })),
    nextPageToken: page.nextPageToken,
    resultSizeEstimate: page.resultSizeEstimate,
    failures: page.failures,
  };
}

export async function scanTransactionEmails(
  account: ConfiguredEmailAccount,
  options: Omit<TransactionEmailSearchOptions, "pageToken">,
  dependencies: TransactionEmailDiscoveryDependencies = {},
): Promise<TransactionEmailScanResult> {
  const emailsById = new Map<string, TransactionEmailInput>();
  const failures: GmailTransactionSearchPage["failures"] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const page = await searchTransactionEmails(account, { ...options, pageToken }, dependencies);
    pages++;
    page.emails.forEach((email) => emailsById.set(email.gmailMessageId, email));
    failures.push(...page.failures);
    if (emailsById.size > MAX_SCAN_MESSAGES || pages >= MAX_SCAN_PAGES && page.nextPageToken) {
      throw new Error("Transaction email discovery exceeded its bounded scan limit");
    }
    if (!page.nextPageToken) break;
    if (seenTokens.has(page.nextPageToken)) throw new Error("Gmail transaction search repeated a page token");
    seenTokens.add(page.nextPageToken);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return { emails: [...emailsById.values()], failures, pages };
}
