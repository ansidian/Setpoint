import { fetchWithTimeout } from "../platform/fetch-with-timeout.ts";
import type { ConfiguredEmailAccount } from "./email-provider-types.ts";
import { chunkArray, getAccessToken } from "./gmail.ts";

export type { ConfiguredEmailAccount } from "./email-provider-types.ts";
export type GmailTransactionSource = "amazon" | "paypal";

interface GmailHeader { name: string; value?: string }
interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
  headers?: GmailHeader[];
}
interface GmailMessage { id: string; threadId?: string; payload?: GmailMessagePart }
interface GmailListResponse {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailTransactionSearchOptions {
  source: GmailTransactionSource;
  start: string | number | Date;
  end: string | number | Date;
  pageToken?: string;
  maxResults: number;
}

export interface GmailTransactionEmail {
  gmailMessageId: string;
  threadId: string | null;
  from: string;
  subject: string;
  date: string;
  internetMessageId: string | null;
  html: string | null;
  text: string | null;
}

export type GmailTransactionSearchErrorCode =
  | "page_token_expired"
  | "rate_limited"
  | "reauth_required"
  | "provider_unavailable"
  | "provider_error";

export class GmailTransactionSearchError extends Error {
  readonly code: GmailTransactionSearchErrorCode;
  readonly status: number;

  constructor(message: string, code: GmailTransactionSearchErrorCode, status: number) {
    super(message);
    this.name = "GmailTransactionSearchError";
    this.code = code;
    this.status = status;
  }
}

export interface GmailTransactionSearchPage {
  emails: GmailTransactionEmail[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
  failures: Array<{ gmailMessageId: string; code: GmailTransactionSearchErrorCode; status: number }>;
}

const SEARCH_TIMEOUT_MS = 30_000;
const SOURCE_QUERY: Record<GmailTransactionSource, string> = {
  amazon: "(from:auto-confirm@amazon.com OR from:digital-no-reply@amazon.com OR from:order-update@amazon.com) (subject:order OR subject:ordered)",
  paypal: "(from:service@paypal.com OR from:service@intl.paypal.com) (subject:paid OR subject:sent OR subject:\"receipt for\" OR subject:\"submitted an order\" OR subject:USD OR subject:CAD OR subject:GBP OR subject:EUR)",
};

function formatSearchDate(value: string | number | Date, dayOffset: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10).replaceAll("-", "/");
}

function header(headers: GmailHeader[], name: string): string {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractBody(payload: GmailMessagePart | undefined): { html: string | null; text: string | null } {
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  function walk(part: GmailMessagePart): void {
    if (part.body?.data && part.mimeType?.startsWith("text/")) {
      try {
        const decoded = Buffer.from(part.body.data, "base64url").toString("utf8");
        if (part.mimeType === "text/html") htmlParts.push(decoded);
        if (part.mimeType === "text/plain") textParts.push(decoded);
      } catch { /* skip malformed MIME parts */ }
    }
    part.parts?.forEach(walk);
  }
  if (payload) walk(payload);
  return {
    html: htmlParts.length ? htmlParts.join("\n") : null,
    text: textParts.length ? textParts.join("\n") : null,
  };
}

function classifyError(status: number, body: string, hasPageToken: boolean): GmailTransactionSearchErrorCode {
  if (status === 400 && hasPageToken) return "page_token_expired";
  if (status === 429 || /rate.?limit|quota/i.test(body)) return "rate_limited";
  if (status === 401 || status === 403) return "reauth_required";
  if (status >= 500) return "provider_unavailable";
  return "provider_error";
}

async function responseError(response: Response, hasPageToken: boolean): Promise<GmailTransactionSearchError> {
  const body = await response.text().catch(() => "");
  const code = classifyError(response.status, body, hasPageToken);
  return new GmailTransactionSearchError(`Gmail transaction search failed (${response.status}, ${code})`, code, response.status);
}

function normalizeMessage(message: GmailMessage): GmailTransactionEmail {
  const headers = message.payload?.headers || [];
  const body = extractBody(message.payload);
  return {
    gmailMessageId: message.id,
    threadId: message.threadId || null,
    from: header(headers, "From"),
    subject: header(headers, "Subject"),
    date: header(headers, "Date"),
    internetMessageId: header(headers, "Message-ID") || null,
    html: body.html,
    text: body.text,
  };
}

export async function fetchGmailTransactionEmailPage(
  account: ConfiguredEmailAccount,
  options: GmailTransactionSearchOptions,
): Promise<GmailTransactionSearchPage> {
  const token = await getAccessToken(account);
  const listUrl = new URL("https://www.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set(
    "q",
    `${SOURCE_QUERY[options.source]} after:${formatSearchDate(options.start, -1)} before:${formatSearchDate(options.end, 1)}`,
  );
  listUrl.searchParams.set("maxResults", String(options.maxResults));
  if (options.pageToken) listUrl.searchParams.set("pageToken", options.pageToken);

  const listResponse = await fetchWithTimeout(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  }, { timeoutMs: SEARCH_TIMEOUT_MS });
  if (!listResponse.ok) throw await responseError(listResponse, Boolean(options.pageToken));
  const listData = await listResponse.json() as GmailListResponse;
  const messageIds = [...new Set((listData.messages || []).map((message) => message.id))];
  const emails: GmailTransactionEmail[] = [];
  const failures: GmailTransactionSearchPage["failures"] = [];

  for (const chunk of chunkArray(messageIds, 15)) {
    const results = await Promise.all(chunk.map(async (messageId) => {
      const response = await fetchWithTimeout(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } },
        { timeoutMs: SEARCH_TIMEOUT_MS },
      );
      if (!response.ok) return { ok: false, messageId, error: await responseError(response, false) } as const;
      return { ok: true, message: await response.json() as GmailMessage } as const;
    }));
    for (const result of results) {
      if (result.ok) emails.push(normalizeMessage(result.message));
      else failures.push({ gmailMessageId: result.messageId, code: result.error.code, status: result.error.status });
    }
  }

  return {
    emails,
    nextPageToken: listData.nextPageToken || null,
    resultSizeEstimate: listData.resultSizeEstimate || 0,
    failures,
  };
}
