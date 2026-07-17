// Pure Gmail Pub/Sub notification decode lifted from gmail-sync.ts: base64url
// JSON decode + emailAddress/historyId payload shaping. No IO.

interface GmailPubSubBody {
  message?: {
    data?: string;
    messageId?: string;
    message_id?: string;
    publishTime?: string;
  };
  subscription?: string;
}

interface GmailPubSubPayload {
  emailAddress?: unknown;
  historyId?: unknown;
}

export interface GmailPubSubNotification {
  emailAddress: string;
  historyId: string;
  pubsubMessageId: string | null;
  publishTime: string | null;
  subscription: string | null;
}

function decodeBase64UrlJson(value: unknown): GmailPubSubPayload {
  if (!value || typeof value !== "string") {
    throw new Error("Pub/Sub message.data is required");
  }
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as GmailPubSubPayload;
  } catch (err) {
    throw new Error(`Invalid Pub/Sub Gmail payload: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function decodeGmailPubSubNotification(body: GmailPubSubBody | null | undefined): GmailPubSubNotification {
  const payload = decodeBase64UrlJson(body?.message?.data);
  const emailAddress = String(payload.emailAddress || "").trim().toLowerCase();
  const historyId = String(payload.historyId || "").trim();
  if (!emailAddress || !historyId) {
    throw new Error("Gmail Pub/Sub payload requires emailAddress and historyId");
  }
  return {
    emailAddress,
    historyId,
    pubsubMessageId: body?.message?.messageId || body?.message?.message_id || null,
    publishTime: body?.message?.publishTime || null,
    subscription: body?.subscription || null,
  };
}
