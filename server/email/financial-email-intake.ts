import { fetchEmailsByIds, getAccessToken } from "./gmail.ts";
import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import type { ConfiguredEmailAccount } from "./email-provider-types.ts";
import type { NormalizedFetchedEmail } from "../../shared/types/email.ts";
export { indexEmails as indexFinancialReceivedEmails } from "./email-index.ts";
export type { ConfiguredEmailAccount } from "./email-provider-types.ts";

export interface FinancialReceivedEmailPage {
  emails: NormalizedFetchedEmail[];
  nextPageToken: string | null;
  unavailableMessageCount: number;
}

/** Received Gmail across Inbox and archived labels; does not alter Inbox membership. */
export async function fetchFinancialReceivedEmailPage(account: ConfiguredEmailAccount, {
  start, end, pageToken, maxResults = 100,
}: { start: string; end: string; pageToken?: string | null; maxResults?: number }): Promise<FinancialReceivedEmailPage> {
  const from = new Date(start).getTime();
  const through = new Date(end).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(through) || through <= from) throw new Error("A valid received-email time window is required");
  if (account.type !== "gmail") throw new Error("Received-email page capture currently supports Gmail");
  const token = await getAccessToken(account);
  const url = new URL("https://www.googleapis.com/gmail/v1/users/me/messages");
  // Epoch seconds avoid Gmail's calendar-day timezone interpretation. One-second
  // overlap makes boundaries inclusive; the index and admission trigger dedupe.
  url.searchParams.set("q", `-in:sent -in:drafts -in:spam -in:trash after:${Math.floor(from / 1000) - 1} before:${Math.ceil(through / 1000) + 1}`);
  url.searchParams.set("maxResults", String(Math.max(1, Math.min(100, Math.trunc(maxResults)))));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
  }, { timeoutMs: 30_000 });
  if (!response.ok) throw Object.assign(new Error(`Received Gmail listing failed: HTTP ${response.status}`), {
    status: response.status, pageTokenExpired: response.status === 400 && Boolean(pageToken),
  });
  const result = await response.json() as { messages?: Array<{ id: string }>; nextPageToken?: string };
  const ids = [...new Set((result.messages || []).map((message) => message.id).filter(Boolean))];
  const emails = await fetchEmailsByIds(account, ids, { strict: true });
  return { emails, nextPageToken: result.nextPageToken || null, unavailableMessageCount: ids.length - emails.length };
}
