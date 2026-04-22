import db from "../db/connection.js";
import { encrypt, decrypt } from "./encryption.js";
import { htmlToPlainText } from "./html-to-text.js";
import { findCanonicalGmailAccount, normalizeEmailAddress } from "./account-canonical.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.NODE_ENV === "production"
  ? process.env.GOOGLE_REDIRECT_URI
  : `http://localhost:${process.env.PORT || 3001}/api/ea/accounts/gmail/callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

// --- OAuth flow ---

export function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function handleCallback(code, _accountId, userId) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const tokens = await res.json();
  const credentials = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    scopes: tokens.scope ? tokens.scope.split(" ").filter(Boolean) : SCOPES,
  };

  // Fetch the user's email address for the label
  const profileRes = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${credentials.access_token}` } },
  );
  const profile = await profileRes.json();
  const email = profile.emailAddress;

  const existingAccounts = await db.execute({
    sql: "SELECT * FROM ea_accounts WHERE user_id = ? AND type = 'gmail' ORDER BY sort_order ASC, created_at ASC",
    args: [userId],
  });
  const canonical = findCanonicalGmailAccount(existingAccounts.rows, email);
  const targetAccountId = canonical?.id || `gmail-${normalizeEmailAddress(email)}`;

  let nextSort = canonical?.sort_order;
  if (nextSort == null) {
    const maxSort = await db.execute({
      sql: "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ea_accounts WHERE user_id = ?",
      args: [userId],
    });
    nextSort = maxSort.rows[0].next;
  }

  await db.execute({
    sql: `INSERT INTO ea_accounts (id, user_id, type, email, label, credentials_encrypted, sort_order)
          VALUES (?, ?, 'gmail', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            credentials_encrypted = excluded.credentials_encrypted,
            email = excluded.email,
            updated_at = datetime('now')`,
    args: [
      targetAccountId,
      userId,
      email,
      canonical?.label || email,
      encrypt(JSON.stringify(credentials)),
      nextSort,
    ],
  });

  return { email, accountId: targetAccountId };
}

async function getValidToken(account) {
  const credentials = JSON.parse(decrypt(account.credentials_encrypted));
  const canonicalAccountId = account.canonical_id || account.id;

  // Refresh if token expires within 5 minutes
  if (credentials.expires_at < Date.now() + 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token refresh failed for ${account.email}: ${text}`);
    }

    const data = await res.json();
    credentials.access_token = data.access_token;
    credentials.expires_at = Date.now() + data.expires_in * 1000;
    // refresh_token is not always returned on refresh
    if (data.refresh_token) credentials.refresh_token = data.refresh_token;
    if (data.scope) credentials.scopes = data.scope.split(" ").filter(Boolean);

    await db.execute({
      sql: `UPDATE ea_accounts SET credentials_encrypted = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [encrypt(JSON.stringify(credentials)), canonicalAccountId],
    });
  }

  return credentials.access_token;
}

// Extract dollar amounts from text for bill detection
function extractAmounts(text) {
  const matches = text.match(/\$\d[\d,]*\.\d{2}/g);
  if (!matches || matches.length === 0) return "";
  const unique = [...new Set(matches)].slice(0, 10);
  return ` [amounts: ${unique.join(", ")}]`;
}

// Decode body text from Gmail API full-format message parts
function extractBodyText(payload) {
  if (!payload) return "";
  const parts = [];

  function walk(part) {
    if (part.body?.data && part.mimeType?.startsWith("text/")) {
      try {
        parts.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
      } catch { /* skip malformed */ }
    }
    if (part.parts) part.parts.forEach(walk);
  }

  walk(payload);
  return htmlToPlainText(parts.join(" "));
}

// --- Email fetch ---

// Safety cap on pagination so a misconfigured query can never spin forever.
// At 500 per page this is 10k messages — far above any realistic briefing window.
const MAX_LIST_PAGES = 20;

export async function fetchEmails(account, hoursBack) {
  const token = await getValidToken(account);

  // Page through message IDs until nextPageToken is exhausted
  const messageIds = [];
  let pageToken;
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
    const listData = await listRes.json();

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

  return messages.map((msg) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ||
      "";

    const snippet = msg.snippet || "";
    const bodyText = extractBodyText(msg.payload);
    const amounts = extractAmounts(bodyText);

    return {
      uid: `gmail-${account.id}-${msg.id}`,
      account_id: account.id,
      account_label: account.label,
      account_email: account.email,
      account_color: account.color,
      account_icon: account.icon || "Mail",
      from: getHeader("From"),
      subject: getHeader("Subject"),
      body_preview: snippet + amounts,
      body_text: bodyText,
      date: getHeader("Date"),
      read: !msg.labelIds?.includes("UNREAD"),
      message_id: getHeader("Message-ID"),
    };
  });
}

export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Fetch Gmail messages in parallel chunks. Drops are logged, not silent.
export async function fetchMessages(token, messageIds) {
  const chunks = chunkArray(messageIds, 15);
  const results = [];
  let dropped = 0;
  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map((id) =>
        fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } },
        ).then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${id}: HTTP ${res.status}`)))),
      ),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
      else {
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

export async function fetchEmailBody(account, uid) {
  const messageId = extractMessageId(account, uid);
  const token = await getValidToken(account);

  // Fetch raw RFC 2822 message and parse with mailparser for reliable decoding
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=raw`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Gmail fetch body failed: ${res.status}`);
  const msg = await res.json();

  const { simpleParser } = await import("mailparser");
  const rawBuffer = Buffer.from(msg.raw, "base64url");
  const parsed = await simpleParser(rawBuffer);

  return {
    html_body: parsed.html || parsed.textAsHtml || parsed.text || "",
    subject: parsed.subject || "",
    from: parsed.from?.text || "",
    date: parsed.date ? parsed.date.toISOString() : "",
  };
}

// --- Email actions (requires gmail.modify scope) ---

function extractMessageId(account, uid) {
  const prefix = `gmail-${account.uid_account_id || account.id}-`;
  return uid.startsWith(prefix) ? uid.slice(prefix.length) : uid;
}

// Returns `true` if the message currently has no UNREAD label, `false` if it
// still does, or `null` on any error (caller treats null as "don't know, leave
// the cached read state alone"). Metadata-only fetch — no body/headers —
// keeps this cheap enough to run per resurfaced row on every live poll.
export async function isMessageRead(account, uid) {
  try {
    const messageId = extractMessageId(account, uid);
    const token = await getValidToken(account);
    const res = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&fields=labelIds`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const msg = await res.json();
    return !msg.labelIds?.includes("UNREAD");
  } catch {
    return null;
  }
}

export async function markAsRead(account, uid) {
  const messageId = extractMessageId(account, uid);
  const token = await getValidToken(account);
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

export async function markAsUnread(account, uid) {
  const messageId = extractMessageId(account, uid);
  const token = await getValidToken(account);
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

export async function trashMessage(account, uid) {
  const messageId = extractMessageId(account, uid);
  const token = await getValidToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`Gmail trash failed: ${res.status}`);
}

export async function archiveMessage(account, uid) {
  const messageId = extractMessageId(account, uid);
  const token = await getValidToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    },
  );
  if (!res.ok) throw new Error(`Gmail archive failed: ${res.status}`);
}

export async function unarchiveMessage(account, uid) {
  const messageId = extractMessageId(account, uid);
  const token = await getValidToken(account);
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds: ["INBOX"] }),
    },
  );
  if (!res.ok) throw new Error(`Gmail unarchive failed: ${res.status}`);
}

// --- EA/Snoozed label (used for native-parity snooze) ---
// Gmail API exposes SNOOZED as read-only for third parties, so we apply our
// own label instead. Cached per-account-id so repeated snooze/wake calls don't
// re-list or recreate the label.
const SNOOZE_LABEL_NAME = "EA/Snoozed";
const labelIdCache = new Map(); // accountId → { [name]: labelId }

async function getOrCreateLabel(account, name) {
  const cacheKey = account.canonical_id || account.id;
  const cache = labelIdCache.get(cacheKey) || {};
  if (cache[name]) return cache[name];

  const token = await getValidToken(account);
  const listRes = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/labels",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) throw new Error(`Gmail labels.list failed: ${listRes.status}`);
  const { labels = [] } = await listRes.json();
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
  const created = await createRes.json();
  cache[name] = created.id;
  labelIdCache.set(cacheKey, cache);
  return created.id;
}

// Apply the EA/Snoozed label and archive (remove INBOX) in a single modify call
// so the email disappears from Gmail's inbox but remains locatable under the
// EA/Snoozed label.
export async function snoozeAtGmail(account, uid) {
  const messageId = extractMessageId(account, uid);
  const labelId = await getOrCreateLabel(account, SNOOZE_LABEL_NAME);
  const token = await getValidToken(account);
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
export async function wakeAtGmail(account, uid) {
  const messageId = extractMessageId(account, uid);
  const labelId = await getOrCreateLabel(account, SNOOZE_LABEL_NAME);
  const token = await getValidToken(account);
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

export async function batchMarkAsRead(account, uids) {
  const token = await getValidToken(account);
  const ids = uids.map(uid => extractMessageId(account, uid));
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

export async function testConnection(account) {
  const token = await getValidToken(account);
  const res = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Gmail test failed: ${res.status}`);
  return true;
}
