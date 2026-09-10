import { simpleParser } from "mailparser";
import { htmlToPlainText } from "./html-to-text.ts";
import { emailEvidenceText } from "./email-evidence.ts";
import { describeMimeAttachments, readMimeAttachment } from "./email-mime-attachments.ts";
import type { EmailBody, EmailRangeResult, NormalizedFetchedEmail } from "../../shared/types/email.ts";
import type { ConfiguredEmailAccount, EmailAttachmentContent } from "./email-provider-types.ts";
import { getAccessToken } from "./gmail-credentials.ts";
import { evaluateGmailSenderAuthentication } from "./sender-authentication.ts";
import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import { FINANCIAL_EMAIL_SOURCE_LIMITS, FinancialEmailSourceError, parseFinancialEmailSource, readFinancialSourceResponse, type FinancialEmailSource } from "./financial-email-source.ts";
export { getAccessToken, handleCallback } from "./gmail-credentials.ts";
export { getAuthUrl } from "./gmail-oauth-url.ts";

interface GmailHeader {
  name: string;
  value?: string;
}

interface GmailMessagePart {
  filename?: string;
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
  headers?: GmailHeader[];
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
  raw?: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailLabel {
  id: string;
  name: string;
}

interface GmailLabelsResponse {
  labels?: GmailLabel[];
  id?: string;
}

interface GmailRangeOptions {
  start?: string | number | Date;
  end?: string | number | Date;
  pageToken?: string;
  maxResults?: number;
}


// Extract dollar amounts from text for bill detection
function extractAmounts(text: string): string {
  const matches = text.match(/\$\d[\d,]*\.\d{2}/g);
  if (!matches || matches.length === 0) return "";
  const unique = [...new Set(matches)].slice(0, 10);
  return ` [amounts: ${unique.join(", ")}]`;
}

// Decode body text from Gmail API full-format message parts
function extractBodyEvidence(payload: GmailMessagePart | null | undefined): { text: string; html: boolean } {
  const empty = { text: "", html: false };
  if (!payload) return empty;
  const disposition = payload.headers?.find((header) => header.name.toLowerCase() === "content-disposition")?.value || "";
  if (payload.filename || /^attachment\b/i.test(disposition)) return empty;
  const mimeType = payload.mimeType?.toLowerCase();
  if (payload.body?.data && (mimeType === "text/plain" || mimeType === "text/html")) {
    const text = Buffer.from(payload.body.data, "base64url").toString("utf8");
    return { text: mimeType === "text/html" ? htmlToPlainText(text) : emailEvidenceText(text, "text"), html: mimeType === "text/html" };
  }
  const parts = (payload.parts || []).map(extractBodyEvidence).filter((part) => part.text);
  if (mimeType === "multipart/alternative") {
    // Prefer the reader's HTML version, including HTML nested in multipart/related.
    // Independent mixed parts are retained below; unused alternatives are not facts.
    return parts.find((part) => part.html) || parts[0] || empty;
  }
  return { text: parts.map((part) => part.text).join("\n\n"), html: parts.some((part) => part.html) };
}

// --- Email fetch ---

// Safety cap on pagination so a misconfigured query can never spin forever.
// At 500 per page this is 10k messages — far above any realistic briefing window.
const MAX_LIST_PAGES = 20;

function getHeaderValue(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function normalizeMessage(account: ConfiguredEmailAccount, msg: GmailMessage): NormalizedFetchedEmail {
  const headers = msg.payload?.headers || [];
  const bodyText = extractBodyEvidence(msg.payload).text;
  // Triage also reads the preview. Gmail's snippet can come from the unused
  // plain alternative, so derive it from the selected body whenever available.
  const snippet = bodyText ? bodyText.slice(0, 600) : msg.snippet || "";
  const amounts = extractAmounts(bodyText);
  const from = getHeaderValue(headers, "From");
  const receivedAt = new Date(Number(msg.internalDate));
  const date = msg.internalDate && Number.isFinite(receivedAt.getTime())
    ? receivedAt.toISOString()
    : getHeaderValue(headers, "Date");

  return {
    uid: `gmail-${account.id}-${msg.id}`,
    account_id: account.id,
    account_label: account.label,
    account_email: account.email,
    account_color: account.color,
    account_icon: account.icon || "Mail",
    from,
    subject: getHeaderValue(headers, "Subject"),
    body_preview: snippet + amounts,
    body_text: bodyText,
    date,
    read: !msg.labelIds?.includes("UNREAD"),
    message_id: getHeaderValue(headers, "Message-ID"),
    thread_id: msg.threadId || null,
    sender_authentication: evaluateGmailSenderAuthentication(headers, from),
  };
}

function formatGmailSearchDate(value: string | number | Date): string {
  return new Date(value).toISOString().slice(0, 10).replaceAll("-", "/");
}

export async function fetchEmails(account: ConfiguredEmailAccount, hoursBack: number): Promise<NormalizedFetchedEmail[]> {
  const token = await getAccessToken(account);

  // Page through message IDs until nextPageToken is exhausted
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const listUrl = new URL(
      "https://www.googleapis.com/gmail/v1/users/me/messages",
    );
    listUrl.searchParams.set("q", `newer_than:${hoursBack}h`);
    listUrl.searchParams.set("labelIds", "INBOX");
    listUrl.searchParams.set("maxResults", "500");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);
    const listData = await listRes.json() as GmailListResponse;

    if (listData.messages) {
      for (const m of listData.messages) messageIds.push(m.id);
    }
    pageToken = listData.nextPageToken;
    pages++;
    if (pages >= MAX_LIST_PAGES && pageToken) {
      console.warn(`[Gmail] ${account.email}: hit MAX_LIST_PAGES (${MAX_LIST_PAGES}), truncating list at ${messageIds.length} messages`);
      break;
    }
  } while (pageToken);

  if (messageIds.length === 0) return [];

  const messages = await fetchMessages(token, messageIds);

  return messages.map((msg) => normalizeMessage(account, msg));
}

export async function fetchEmailsInRange(account: ConfiguredEmailAccount, {
  start,
  end,
  pageToken,
  maxResults = 500,
}: GmailRangeOptions = {}): Promise<EmailRangeResult> {
  if (!start || !end) {
    throw new Error("Gmail range fetch requires start and end dates");
  }

  const token = await getAccessToken(account);
  const listUrl = new URL(
    "https://www.googleapis.com/gmail/v1/users/me/messages",
  );
  listUrl.searchParams.set(
    "q",
    `after:${formatGmailSearchDate(start)} before:${formatGmailSearchDate(end)}`,
  );
  listUrl.searchParams.set("labelIds", "INBOX");
  listUrl.searchParams.set("maxResults", String(maxResults));
  if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`Gmail range list failed: ${listRes.status}`);
  const listData = await listRes.json() as GmailListResponse;
  const messageIds = (listData.messages || []).map((message) => message.id);
  const messages = messageIds.length ? await fetchMessages(token, messageIds) : [];

  return {
    emails: messages.map((msg) => normalizeMessage(account, msg)),
    nextPageToken: listData.nextPageToken || null,
    resultSizeEstimate: listData.resultSizeEstimate || 0,
  };
}

export async function fetchEmailsByIds(account: ConfiguredEmailAccount, messageIds: string[], { strict = false }: { strict?: boolean } = {}): Promise<NormalizedFetchedEmail[]> {
  if (!messageIds?.length) return [];
  const token = await getAccessToken(account);
  const messages = await fetchMessages(token, messageIds, { strict });
  return messages.map((msg) => normalizeMessage(account, msg));
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Fetch Gmail messages in parallel chunks. Drops are logged, not silent.
export async function fetchMessages(token: string, messageIds: string[], { strict = false }: { strict?: boolean } = {}): Promise<GmailMessage[]> {
  const chunks = chunkArray(messageIds, 15);
  const results: GmailMessage[] = [];
  let dropped = 0;
  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map(async (id) => {
        const url = `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
        const options = { headers: { Authorization: `Bearer ${token}` } };
        const res = strict ? await fetchWithTimeout(url, options, { timeoutMs: 30_000 }) : await fetch(url, options);
        // A deleted source cannot be captured. Other failures must leave a
        // durable acquisition page unadvanced so the missing receipt retries.
        if (strict && res.status === 404) return null;
        if (!res.ok) throw Object.assign(new Error(`${id}: HTTP ${res.status}`), { status: res.status });
        return res.json();
      }),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") {
        if (s.value) results.push(s.value as GmailMessage);
      }
      else {
        if (strict) throw s.reason;
        dropped++;
        console.warn(`[Gmail] dropped message: ${s.reason?.message || s.reason}`);
      }
    }
  }
  if (dropped > 0) {
    console.warn(`[Gmail] ${dropped}/${messageIds.length} messages dropped during fetch`);
  }
  return results;
}

// --- Full email body (for detail view) ---

/** One unmodified raw message supplies the body, PDF bytes, identity, and authentication. */
export async function fetchFinancialEmailSource(account: ConfiguredEmailAccount, uid: string): Promise<FinancialEmailSource> {
  const messageId = extractMessageId(account, uid);
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) throw new FinancialEmailSourceError("financial_source_invalid", "The Gmail source identity is invalid.", 400);
  const token = await getAccessToken(account);
  let value: unknown;
  try {
    const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=raw`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FINANCIAL_EMAIL_SOURCE_LIMITS.fetchTimeoutMs),
    });
    if (!response.ok) throw new FinancialEmailSourceError("financial_source_unavailable", `Gmail source acquisition failed: HTTP ${response.status}.`, response.status);
    value = await readFinancialSourceResponse(response);
  } catch (error) {
    if (error instanceof FinancialEmailSourceError) throw error;
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw new FinancialEmailSourceError(timedOut ? "financial_source_timeout" : "financial_source_unavailable", timedOut ? "Gmail source acquisition exceeded its time limit." : "Gmail source acquisition failed before returning a complete message.", 503);
  }
  const message = value as GmailMessage | null;
  if (!message || message.id !== messageId || typeof message.raw !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(message.raw)) {
    throw new FinancialEmailSourceError("financial_source_unavailable", "Gmail did not return the complete requested source.", 502);
  }
  if (message.raw.replace(/=+$/, "").length > Math.ceil(FINANCIAL_EMAIL_SOURCE_LIMITS.messageBytes * 4 / 3)) {
    throw new FinancialEmailSourceError("financial_source_oversized", "The original Gmail message exceeds the financial evidence byte limit.", 413);
  }
  const date = new Date(Number(message.internalDate));
  return parseFinancialEmailSource(Buffer.from(message.raw, "base64url"), {
    provider: "gmail", threadId: message.threadId,
    emailDate: message.internalDate && Number.isFinite(date.getTime()) ? date.toISOString() : undefined,
  });
}

export async function fetchEmailBody(account: ConfiguredEmailAccount, uid: string): Promise<EmailBody> {
  const messageId = extractMessageId(account, uid);
  const token = await getAccessToken(account);

  // Fetch raw RFC 2822 message and parse with mailparser for reliable decoding
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=raw`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Gmail fetch body failed: ${res.status}`);
  const msg = await res.json() as GmailMessage;

  const rawBuffer = Buffer.from(msg.raw || "", "base64url");
  const parsed = await simpleParser(rawBuffer);

  return {
    html_body: parsed.html || parsed.textAsHtml || parsed.text || "",
    subject: parsed.subject || "",
    from: parsed.from?.text || "",
    from_address: parsed.from?.value?.[0]?.address || "",
    date: parsed.date ? parsed.date.toISOString() : "",
    attachments: describeMimeAttachments(parsed.attachments),
  };
}

export async function fetchEmailAttachment(
  account: ConfiguredEmailAccount,
  uid: string,
  attachmentId: string,
): Promise<EmailAttachmentContent> {
  const messageId = extractMessageId(account, uid);
  const token = await getAccessToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=raw`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Gmail fetch attachment failed: ${res.status}`);
  const msg = await res.json() as GmailMessage;
  const parsed = await simpleParser(Buffer.from(msg.raw || "", "base64url"));
  return readMimeAttachment(parsed.attachments, attachmentId);
}

// --- Email actions (requires gmail.modify scope) ---

function extractMessageId(account: ConfiguredEmailAccount, uid: string): string {
  const prefix = `gmail-${account.uid_account_id || account.id}-`;
  return uid.startsWith(prefix) ? uid.slice(prefix.length) : uid;
}

// Metadata-only provider read used by incremental sync to reconcile cached
// read state without fetching message bodies.
export async function isMessageRead(account: ConfiguredEmailAccount, uid: string): Promise<boolean | null> {
  try {
    const messageId = extractMessageId(account, uid);
    const token = await getAccessToken(account);
    const res = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&fields=labelIds`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const msg = await res.json() as GmailMessage;
    return !msg.labelIds?.includes("UNREAD");
  } catch {
    return null;
  }
}

export async function markAsRead(account: ConfiguredEmailAccount, uid: string): Promise<void> {
  const messageId = extractMessageId(account, uid);
  const token = await getAccessToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    },
  );
  if (!res.ok) throw new Error(`Gmail mark-as-read failed: ${res.status}`);
}

export async function markAsUnread(account: ConfiguredEmailAccount, uid: string): Promise<void> {
  const messageId = extractMessageId(account, uid);
  const token = await getAccessToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds: ["UNREAD"] }),
    },
  );
  if (!res.ok) throw new Error(`Gmail mark-as-unread failed: ${res.status}`);
}

export async function trashMessage(account: ConfiguredEmailAccount, uid: string): Promise<void> {
  const messageId = extractMessageId(account, uid);
  const token = await getAccessToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`Gmail trash failed: ${res.status}`);
}

// --- EA/Snoozed label (used for native-parity snooze) ---
// Gmail API exposes SNOOZED as read-only for third parties, so we apply our
// own label instead. Cached per-account-id so repeated snooze/wake calls don't
// re-list or recreate the label.
const SNOOZE_LABEL_NAME = "EA/Snoozed";
const labelIdCache = new Map<string, Record<string, string>>(); // accountId → { [name]: labelId }

async function getOrCreateLabel(account: ConfiguredEmailAccount, name: string): Promise<string> {
  const cacheKey = account.canonical_id || account.id;
  const cache = labelIdCache.get(cacheKey) || {};
  if (cache[name]) return cache[name];

  const token = await getAccessToken(account);
  const listRes = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/labels",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) throw new Error(`Gmail labels.list failed: ${listRes.status}`);
  const { labels = [] } = await listRes.json() as GmailLabelsResponse;
  const found = labels.find((l) => l.name === name);
  if (found) {
    cache[name] = found.id;
    labelIdCache.set(cacheKey, cache);
    return found.id;
  }

  const createRes = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/labels",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    },
  );
  if (!createRes.ok) throw new Error(`Gmail labels.create failed: ${createRes.status}`);
  const created = await createRes.json() as GmailLabelsResponse;
  cache[name] = created.id || "";
  labelIdCache.set(cacheKey, cache);
  return created.id || "";
}

// Apply the EA/Snoozed label and archive (remove INBOX) in a single modify call
// so the email disappears from Gmail's inbox but remains locatable under the
// EA/Snoozed label.
export async function snoozeAtGmail(account: ConfiguredEmailAccount, uid: string): Promise<void> {
  const messageId = extractMessageId(account, uid);
  const labelId = await getOrCreateLabel(account, SNOOZE_LABEL_NAME);
  const token = await getAccessToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        addLabelIds: [labelId],
        removeLabelIds: ["INBOX"],
      }),
    },
  );
  if (!res.ok) throw new Error(`Gmail snooze-modify failed: ${res.status}`);
}

// Reverse of snoozeAtGmail: remove EA/Snoozed, add INBOX + UNREAD so the email
// re-enters the inbox as a fresh unread (matching Gmail native-snooze parity).
export async function wakeAtGmail(account: ConfiguredEmailAccount, uid: string): Promise<void> {
  const messageId = extractMessageId(account, uid);
  const labelId = await getOrCreateLabel(account, SNOOZE_LABEL_NAME);
  const token = await getAccessToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        addLabelIds: ["INBOX", "UNREAD"],
        removeLabelIds: [labelId],
      }),
    },
  );
  if (!res.ok) throw new Error(`Gmail wake-modify failed: ${res.status}`);
}

export async function batchMarkAsRead(account: ConfiguredEmailAccount, uids: string[]): Promise<void> {
  const token = await getAccessToken(account);
  const ids = uids.map((uid) => extractMessageId(account, uid));
  const res = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages/batchModify",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ids, removeLabelIds: ["UNREAD"] }),
    },
  );
  if (!res.ok) throw new Error(`Gmail batch mark-as-read failed: ${res.status}`);
}

// --- Connection test ---

export async function testConnection(account: ConfiguredEmailAccount): Promise<boolean> {
  const token = await getAccessToken(account);
  const res = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Gmail test failed: ${res.status}`);
  return true;
}
