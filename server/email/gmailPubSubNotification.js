// Pure Gmail Pub/Sub notification decode lifted from gmail-sync.js: base64url
// JSON decode + emailAddress/historyId payload shaping. No IO.

function decodeBase64UrlJson(value) {
  if (!value || typeof value !== "string") {
    throw new Error("Pub/Sub message.data is required");
  }
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (err) {
    throw new Error(`Invalid Pub/Sub Gmail payload: ${err.message}`);
  }
}

export function decodeGmailPubSubNotification(body) {
  const payload = decodeBase64UrlJson(body?.message?.data);
  const emailAddress = String(payload.emailAddress || "").trim().toLowerCase();
  const historyId = String(payload.historyId || "").trim();
  if (!emailAddress || !historyId) {
    throw new Error("Gmail Pub/Sub payload requires emailAddress and historyId");
  }
  return {
    emailAddress,
    historyId,
    pubsubMessageId: body.message?.messageId || body.message?.message_id || null,
    publishTime: body.message?.publishTime || null,
    subscription: body.subscription || null,
  };
}
