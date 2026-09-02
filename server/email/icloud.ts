import { ImapFlow } from "imapflow";
import type { FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToPlainText } from "./html-to-text.ts";
import { describeMimeAttachments, readMimeAttachment } from "./email-mime-attachments.ts";
import { withTimeout } from "../platform/fetch-with-timeout.ts";
import type { EmailBody, EmailRangeResult, NormalizedFetchedEmail } from "../../shared/types/email.ts";
import type { ConfiguredEmailAccount, EmailAttachmentContent, EmailHttpError } from "./email-provider-types.ts";
import { emailErrorMessage } from "./email-provider-types.ts";
import { unavailableEmailAuthentication } from "./sender-authentication.ts";

const ICLOUD_HOST = "imap.mail.me.com";
const ICLOUD_PORT = 993;
const ICLOUD_CONNECT_TIMEOUT_MS = 15_000;

// --- Connection pool: one persistent connection per iCloud account ---
interface ICloudPoolEntry {
  clientPromise: Promise<ImapFlow>;
  lastUsed: number;
}

interface ICloudRangeOptions {
  start?: string | number | Date;
  end?: string | number | Date;
  limit?: number;
  cursor?: string;
}

const pool = new Map<string, ICloudPoolEntry>(); // email → { clientPromise, lastUsed }
const POOL_TTL = 10 * 60 * 1000; // close idle connections after 10 min

function createClient(email: string, password: string): ImapFlow {
  return new ImapFlow({
    host: ICLOUD_HOST,
    port: ICLOUD_PORT,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    // Belt-and-braces: ImapFlow's own connect timeout, in addition to the
    // withTimeout race below (which is what actually guards against a
    // connect() that never settles at all).
    connectionTimeout: ICLOUD_CONNECT_TIMEOUT_MS,
  });
}

export async function getPooledClient(email: string, password: string): Promise<ImapFlow> {
  const existing = pool.get(email);
  if (existing) {
    const client = await existing.clientPromise;
    // Check if connection is still alive
    if (client.usable) {
      existing.lastUsed = Date.now();
      return client;
    }
    // Dead connection — clean up
    pool.delete(email);
    (client.close() as unknown as Promise<void>).catch(() => {});
  }

  // Synchronously claim the pool slot with the in-flight connect promise
  // BEFORE any await, so a concurrent second caller that reads `pool` finds
  // this entry and awaits the same promise instead of racing its own
  // createClient()+connect().
  const entry = {
    lastUsed: Date.now(),
    clientPromise: (async () => {
      const client = createClient(email, password);
      try {
        await withTimeout(client.connect(), ICLOUD_CONNECT_TIMEOUT_MS, "iCloud IMAP connect");
      } catch (err) {
        // Connect failed (including timeout) — evict so the next call
        // retries with a fresh client, and best-effort tear down this one.
        pool.delete(email);
        try {
          client.close();
        } catch { /* connection already dead */ }
        client.logout().catch(() => {});
        throw err;
      }

      // Auto-cleanup on unexpected close or error
      client.on("close", () => {
        const current = pool.get(email);
        current?.clientPromise?.then((c) => {
          if (c === client) pool.delete(email);
        }).catch(() => {});
      });

      client.on("error", (err) => {
        console.warn(`[iCloud] Connection error for ${email}: ${err.message}`);
        const current = pool.get(email);
        current?.clientPromise?.then((c) => {
          if (c === client) pool.delete(email);
        }).catch(() => {});
        try { (client.close() as unknown as Promise<void>).catch(() => {}); } catch { /* connection already dead */ }
      });

      return client;
    })(),
  };
  pool.set(email, entry);

  return entry.clientPromise;
}

// Periodically close idle connections
const poolCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of pool) {
    if (now - entry.lastUsed > POOL_TTL) {
      pool.delete(email);
      entry.clientPromise.then((client) => client.logout().catch(() => {})).catch(() => {});
    }
  }
}, 60_000);
poolCleanupTimer.unref(); // don't keep process alive just for cleanup

export async function fetchEmails(
  account: ConfiguredEmailAccount,
  password: string,
  hoursBack: number,
): Promise<NormalizedFetchedEmail[]> {
  const client = await getPooledClient(account.email, password);
  const emails: NormalizedFetchedEmail[] = [];
  const lock = await client.getMailboxLock("INBOX");

  try {
    const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const sinceDate = new Date(
      cutoffDate.getFullYear(),
      cutoffDate.getMonth(),
      cutoffDate.getDate(),
    );

    const searchResults = await client.search({ since: sinceDate });
    if (!searchResults || searchResults.length === 0) return [];

    for await (const msg of client.fetch(searchResults, {
      envelope: true,
      flags: true,
      bodyStructure: true,
      // 256KB is comfortably larger than virtually any real email. Raised from
      // 16KB so body_text captures the full content for FTS indexing.
      source: { start: 0, maxLength: 262144 },
    })) {
      const msgDate = msg.envelope?.date;
      if (msgDate && new Date(msgDate) < cutoffDate) continue;
      emails.push(await normalizeMessage(account, msg));
    }
  } finally {
    lock.release();
  }

  // Connection stays alive in pool for body fetches
  return emails;
}

export async function fetchEmailsInRange(account: ConfiguredEmailAccount, password: string, {
  start,
  end,
  limit,
}: ICloudRangeOptions = {}): Promise<EmailRangeResult> {
  if (!start || !end) {
    throw new Error("iCloud range fetch requires start and end dates");
  }

  const client = await getPooledClient(account.email, password);
  const emails: NormalizedFetchedEmail[] = [];
  const lock = await client.getMailboxLock("INBOX");

  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const searchResults = await client.search({ since: startDate, before: endDate });
    if (!searchResults || searchResults.length === 0) return { emails: [], cursor: null };

    const selectedResults = limit ? searchResults.slice(0, limit) : searchResults;
    for await (const msg of client.fetch(selectedResults, {
      envelope: true,
      flags: true,
      bodyStructure: true,
      source: { start: 0, maxLength: 262144 },
    })) {
      const msgDate = msg.envelope?.date ? new Date(msg.envelope.date) : null;
      if (msgDate && (msgDate < startDate || msgDate >= endDate)) continue;
      emails.push(await normalizeMessage(account, msg));
    }
  } finally {
    lock.release();
  }

  return { emails, cursor: null };
}

async function normalizeMessage(account: ConfiguredEmailAccount, msg: FetchMessageObject): Promise<NormalizedFetchedEmail> {
  const msgDate = msg.envelope?.date;
  const from = msg.envelope?.from?.[0];
  const fromName = from?.name || from?.address || "Unknown";
  const fromAddress = from?.address || "";

  const { bodyText, bodyPreview } = await extractBodyTextAndPreview(msg.source);
  return {
    uid: `icloud-${msg.uid}`,
    account_id: account.id,
    account_label: account.label,
    account_email: account.email,
    account_color: account.color,
    account_icon: account.icon || "Apple",
    from: fromName,
    from_email: fromAddress,
    subject: msg.envelope?.subject || "(no subject)",
    body_preview: bodyPreview,
    body_text: bodyText,
    date: msgDate ? new Date(msgDate).toISOString() : "",
    read: msg.flags?.has("\\Seen") || false,
    // IMAP has no Gmail-style thread id; Message-ID rides the envelope for free.
    thread_id: null,
    message_id: msg.envelope?.messageId || null,
    sender_authentication: unavailableEmailAuthentication("icloud", fromAddress),
  };
}

function extractAmounts(text: string): string {
  const matches = text.match(/\$\d[\d,]*\.\d{2}/g);
  if (!matches || matches.length === 0) return "";
  const unique = [...new Set(matches)].slice(0, 10);
  return ` [amounts: ${unique.join(", ")}]`;
}

// P2-1: decode the raw source ONCE, then derive both the full body_text (for FTS)
// and the 600-char body_preview (+amounts) from the same clean text.
// D1 fix: MIME-parse with mailparser (same as gmail.ts and fetchEmailBody below)
// so multipart/quoted-printable/base64 messages index as decoded text, not raw MIME.
async function extractBodyTextAndPreview(source: Buffer | null | undefined): Promise<{ bodyText: string; bodyPreview: string }> {
  if (!source) return { bodyText: "", bodyPreview: "" };
  let clean = "";
  try {
    const parsed = await simpleParser(source);
    const text = (parsed.text || "").trim();
    clean = text || htmlToPlainText(parsed.html || "");
  } catch {
    // Malformed message: fall back to the old naive split so it still indexes.
    const text = source.toString("utf8");
    const bodyStart = text.indexOf("\r\n\r\n");
    clean = bodyStart === -1 ? "" : htmlToPlainText(text.slice(bodyStart + 4));
  }
  return { bodyText: clean, bodyPreview: clean.slice(0, 600) + extractAmounts(clean) };
}

export async function fetchEmailBody(email: string, password: string, uid: string): Promise<EmailBody> {
  const imapUid = parseInt(uid.replace("icloud-", ""), 10);
  const client = await getPooledClient(email, password);
  const lock = await client.getMailboxLock("INBOX");

  try {
    const msg = await client.fetchOne(String(imapUid), {
      source: true,
      envelope: true,
    }, { uid: true });

    if (!msg) {
      const err = new Error(`Message UID ${imapUid} not found`) as EmailHttpError;
      err.status = 404;
      throw err;
    }

    const parsed = await simpleParser(msg.source!);

    return {
      html_body: parsed.html || parsed.textAsHtml || parsed.text || "",
      subject: parsed.subject || msg.envelope?.subject || "",
      from: parsed.from?.text || msg.envelope?.from?.[0]?.name || "",
      date: parsed.date ? parsed.date.toISOString() : "",
      attachments: describeMimeAttachments(parsed.attachments),
    };
  } finally {
    lock.release();
  }
}

export async function fetchEmailAttachment(
  email: string,
  password: string,
  uid: string,
  attachmentId: string,
): Promise<EmailAttachmentContent> {
  const imapUid = parseInt(uid.replace("icloud-", ""), 10);
  const client = await getPooledClient(email, password);
  const lock = await client.getMailboxLock("INBOX");

  try {
    const msg = await client.fetchOne(String(imapUid), { source: true }, { uid: true });
    if (!msg || !msg.source) {
      const err = new Error(`Message UID ${imapUid} not found`) as EmailHttpError;
      err.status = 404;
      throw err;
    }
    const parsed = await simpleParser(msg.source);
    return readMimeAttachment(parsed.attachments, attachmentId);
  } finally {
    lock.release();
  }
}

// --- Email actions ---

export async function markAsRead(email: string, password: string, uid: string): Promise<void> {
  const imapUid = parseInt(uid.replace("icloud-", ""), 10);
  const client = await getPooledClient(email, password);
  const lock = await client.getMailboxLock("INBOX");
  try {
    await client.messageFlagsAdd({ uid: imapUid }, ["\\Seen"], { uid: true });
  } finally {
    lock.release();
  }
}

export async function markAsUnread(email: string, password: string, uid: string): Promise<void> {
  const imapUid = parseInt(uid.replace("icloud-", ""), 10);
  const client = await getPooledClient(email, password);
  const lock = await client.getMailboxLock("INBOX");
  try {
    await client.messageFlagsRemove({ uid: imapUid }, ["\\Seen"], { uid: true });
  } finally {
    lock.release();
  }
}

export async function trashMessage(email: string, password: string, uid: string): Promise<void> {
  const imapUid = parseInt(uid.replace("icloud-", ""), 10);
  const client = await getPooledClient(email, password);
  const lock = await client.getMailboxLock("INBOX");
  try {
    await client.messageMove({ uid: imapUid }, "Trash", { uid: true });
  } finally {
    lock.release();
  }
}

export async function batchMarkAsRead(email: string, password: string, uids: string[]): Promise<void> {
  const imapUids = uids.map((uid) => parseInt(uid.replace("icloud-", ""), 10));
  const client = await getPooledClient(email, password);
  const lock = await client.getMailboxLock("INBOX");
  try {
    await client.messageFlagsAdd(imapUids, ["\\Seen"], { uid: true });
  } finally {
    lock.release();
  }
}

// --- Connection test ---

export async function testConnection(email: string, password: string): Promise<boolean> {
  const client = createClient(email, password);
  try {
    await client.connect();
    await client.logout();
    return true;
  } catch (err) {
    throw new Error(`iCloud IMAP connection failed: ${emailErrorMessage(err)}`);
  }
}
