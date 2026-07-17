import { getAccessToken } from "./gmail.ts";
import type { ConfiguredEmailAccount } from "./email-provider-types.ts";
import type {
  GmailHistoryPage,
  EmailFetch,
  GmailMessageMetadata,
  GmailSyncError,
  GmailWatchResponse,
  GmailSyncAccount,
} from "./email-sync-types.ts";

interface GmailRequestOptions {
  fetchImpl?: EmailFetch;
  token?: string;
}

// Raw Gmail HTTP calls lifted from gmail-sync.ts: history.list paging, per-message
// metadata, profile historyId, and the watch-registration POST. Each resolves the
// access token via the `token || await getAccessToken(account)` injection pattern.

export async function fetchGmailHistoryPage({
  account,
  startHistoryId,
  pageToken = null,
  fetchImpl = fetch,
  token,
}: GmailRequestOptions & {
  account: GmailSyncAccount;
  startHistoryId: string;
  pageToken?: string | null;
}): Promise<GmailHistoryPage> {
  const accessToken = token || await getAccessToken(account as ConfiguredEmailAccount);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.append("historyTypes", "messageAdded");
  url.searchParams.append("historyTypes", "labelAdded");
  url.searchParams.append("historyTypes", "labelRemoved");
  url.searchParams.append("historyTypes", "messageDeleted");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = new Error(`Gmail history.list failed for ${account.email}: ${res.status}`) as GmailSyncError;
    err.status = res.status;
    throw err;
  }
  return await res.json() as GmailHistoryPage;
}

export async function fetchGmailMessageMetadata(account: GmailSyncAccount, messageId: string, {
  fetchImpl = fetch,
  token,
}: GmailRequestOptions = {}): Promise<GmailMessageMetadata | null> {
  const accessToken = token || await getAccessToken(account as ConfiguredEmailAccount);
  const res = await fetchImpl(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&fields=labelIds`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gmail message metadata failed for ${account.email}/${messageId}: ${res.status}`);
  return await res.json() as GmailMessageMetadata;
}

// Returns the account's CURRENT historyId via users.getProfile, used by the
// 404-recovery branch so it never re-persists the stale cursor that just 404'd.
export async function fetchGmailProfileHistoryId(account: GmailSyncAccount, {
  fetchImpl = fetch,
  token,
}: GmailRequestOptions = {}): Promise<string | null> {
  const accessToken = token || await getAccessToken(account as ConfiguredEmailAccount);
  const res = await fetchImpl(
    "https://www.googleapis.com/gmail/v1/users/me/profile?fields=historyId",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Gmail profile fetch failed for ${account.email}: ${res.status}`);
  const profile = await res.json() as { historyId?: unknown };
  const historyId = profile?.historyId ? String(profile.historyId) : null;
  return historyId;
}

// The watch-registration POST, extracted from registerGmailWatch so the
// orchestrator composes requestGmailWatch + persistGmailWatchState. Returns the
// parsed watch response ({ historyId, expiration }) or throws verbatim on !ok.
export async function requestGmailWatch(account: GmailSyncAccount, {
  fetchImpl = fetch,
  token,
  topicName,
}: GmailRequestOptions & { topicName?: string } = {}): Promise<GmailWatchResponse> {
  const accessToken = token || await getAccessToken(account as ConfiguredEmailAccount);
  const res = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
      topicName,
    }),
  });
  if (!res.ok) {
  const text = await res.text?.();
    throw new Error(`Gmail watch failed for ${account.email}: ${res.status}${text ? ` ${text}` : ""}`);
  }
  return await res.json() as GmailWatchResponse;
}
