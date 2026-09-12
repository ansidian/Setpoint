import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Client, Row } from "@libsql/client";
import db from "../db/connection.ts";
import { canonicalizeConfiguredAccounts } from "../platform/account-canonical.ts";
import { createCanonicalUrlService } from "../platform/canonical-url.ts";
import {
  getAuthorizedAccount,
  googleCalendarFetch,
  invalidateCalendarListCache,
  listCalendarsForAccount,
  type AuthorizedCalendarAccount,
  type StoredCalendarAccount,
} from "./calendar-google-client.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const WATCH_TTL_MS = 7 * DAY_MS;
const REGISTRATION_TIMEOUT_MS = 10 * 60 * 1000;
const CALENDAR_LIST_SCOPES = new Set([
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
]);

type PushDb = Pick<Client, "execute">;
type PushOptions = { dbClient?: Client; nowMs?: number };
type Channel = Row & {
  channel_id: string;
  user_id: string;
  account_id: string;
  kind: "events" | "calendar_list";
  calendar_id: string;
  callback_url: string;
  token_hash: string;
  resource_id: string | null;
  status: "pending" | "active" | "failed" | "retired";
  push_unsupported: number;
  created_at: number;
  expires_at: number;
};

export type CalendarPushHeaders = Record<string, string | string[] | undefined>;
export type CalendarPushHealth = {
  state: "inactive" | "current" | "degraded";
  message?: string;
  activeChannels: number;
  lastNotificationAt: number | null;
};
type ReconcileResult = { registered: number; stopped: number; failed: number; skipped: boolean };
const reconciliations = new WeakMap<Client, Map<string, Promise<ReconcileResult>>>();

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function configuredAccounts(userId: string, dbClient: PushDb) {
  const result = await dbClient.execute({
    sql: "SELECT * FROM ea_accounts WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC",
    args: [userId],
  });
  return canonicalizeConfiguredAccounts(result.rows) as unknown as StoredCalendarAccount[];
}

function enabled(account: StoredCalendarAccount) {
  return account.type === "gmail" && Boolean(account.calendar_enabled)
    && !account.needs_reauth && Boolean(account.credentials_encrypted);
}

function syncRequest(userId: string, nowMs: number) {
  return {
    sql: `INSERT INTO ea_calendar_push_sync
            (user_id, requested_revision, requested_at, next_attempt_at)
          VALUES (?, 1, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            requested_revision = ea_calendar_push_sync.requested_revision + 1,
            requested_at = excluded.requested_at,
            next_attempt_at = MIN(ea_calendar_push_sync.next_attempt_at, excluded.next_attempt_at)`,
    args: [userId, nowMs, nowMs],
  };
}

export async function requestCalendarPushSync(
  userId: string,
  nowMs = Date.now(),
  { dbClient = db }: { dbClient?: Client } = {},
) {
  await dbClient.execute(syncRequest(userId, nowMs));
}

function header(headers: CalendarPushHeaders, name: string, maxLength: number) {
  const values = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  const value = values.length === 1 ? values[0]?.[1] : undefined;
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    && /^[\x21-\x7e]+$/.test(value) ? value : null;
}

function resourcePath(channel: Pick<Channel, "kind" | "calendar_id">) {
  return channel.kind === "calendar_list"
    ? "users/me/calendarList"
    : `calendars/${encodeURIComponent(channel.calendar_id)}/events`;
}

function resourceUriMatches(value: string, channel: Pick<Channel, "kind" | "calendar_id">) {
  try {
    const uri = new URL(value);
    return uri.origin === "https://www.googleapis.com" && !uri.username && !uri.password
      && !uri.hash
      // Google may append representation options such as ?alt=json. Identity
      // comes from the matched collection path and the stored opaque resource ID.
      && decodeURIComponent(uri.pathname) === decodeURIComponent(`/calendar/v3/${resourcePath(channel)}`);
  } catch {
    return false;
  }
}

export async function acceptCalendarPushNotification(
  headers: CalendarPushHeaders,
  { dbClient = db, nowMs = Date.now() }: PushOptions = {},
): Promise<{ accepted: boolean; userId?: string; queued?: boolean; reconcile?: boolean }> {
  const channelId = header(headers, "x-goog-channel-id", 64);
  const token = header(headers, "x-goog-channel-token", 256);
  const resourceId = header(headers, "x-goog-resource-id", 1024);
  const resourceUri = header(headers, "x-goog-resource-uri", 2048);
  const state = header(headers, "x-goog-resource-state", 16);
  const message = header(headers, "x-goog-message-number", 20);
  if (!channelId || !token || !resourceId || !resourceUri || !message
    || !/^[1-9][0-9]{0,19}$/.test(message)
    || !["sync", "exists", "not_exists"].includes(state || "")
    || (state === "sync" && message !== "1")) return { accepted: false };

  const tx = await dbClient.transaction("write");
  let accountId: string | undefined;
  let userId: string | undefined;
  let reconcile = false;
  try {
    const rows = await tx.execute({
      sql: "SELECT * FROM ea_calendar_push_channels WHERE channel_id = ?",
      args: [channelId],
    });
    const channel = rows.rows[0] as Channel | undefined;
    const pending = channel?.status === "pending";
    if (!channel || !(channel.status === "active" || pending) || Number(channel.expires_at) <= nowMs
      || (pending && Number(channel.created_at) + REGISTRATION_TIMEOUT_MS <= nowMs)
      || !/^[a-f0-9]{64}$/.test(channel.token_hash)
      || !timingSafeEqual(Buffer.from(channel.token_hash, "hex"), Buffer.from(tokenHash(token), "hex"))
      || !resourceUriMatches(resourceUri, channel)
      || (channel.resource_id ? channel.resource_id !== resourceId : !pending || state !== "sync")) {
      await tx.rollback();
      return { accepted: false };
    }
    const accounts = await configuredAccounts(channel.user_id, tx);
    if (!accounts.some((account) => account.id === channel.account_id && enabled(account))) {
      await tx.rollback();
      return { accepted: false };
    }
    // Duplicate/out-of-order deliveries are harmless. Receipt evidence and the
    // revision increment commit together, so an acknowledgement never loses work.
    await tx.execute({
      sql: `UPDATE ea_calendar_push_channels
            SET resource_id = COALESCE(resource_id, ?), last_notification_at = ?, last_message_number = ?
            WHERE channel_id = ?`,
      args: [resourceId, nowMs, message, channelId],
    });
    await tx.execute(syncRequest(channel.user_id, nowMs));
    await tx.commit();
    accountId = channel.account_id;
    userId = channel.user_id;
    reconcile = channel.kind === "calendar_list";
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
  invalidateCalendarListCache(accountId);
  return { accepted: true, userId, queued: true, ...(reconcile ? { reconcile: true } : {}) };
}

function sanitizedFailure(error: unknown) {
  const detail = error as { code?: string; googleStatus?: number; name?: string };
  if (detail?.code === "calendar_google_forbidden" || detail?.code?.startsWith("calendar_auth_")
    || detail?.code === "calendar_token_refresh_failed") {
    return "Google Calendar push authorization failed. Reconnect the account if retries keep failing.";
  }
  return "Google Calendar push registration could not be refreshed. Automatic retry is pending.";
}

function isPushUnsupported(error: unknown) {
  const detail = error as { googleStatus?: number; googleReason?: string };
  return detail?.googleStatus === 400 && detail?.googleReason === "pushNotSupportedForRequestedResource";
}

async function recordAttempt(dbClient: Client, userId: string, accountId: string, nowMs: number, error: string | null, expectedChannels: number | null = null) {
  await dbClient.execute({
    sql: `INSERT INTO ea_calendar_push_watch_state
            (user_id, account_id, last_attempt_at, last_success_at, last_error, failure_count, expected_channels)
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 0))
          ON CONFLICT(user_id, account_id) DO UPDATE SET
            last_attempt_at = excluded.last_attempt_at,
            last_success_at = COALESCE(excluded.last_success_at, ea_calendar_push_watch_state.last_success_at),
            last_error = excluded.last_error,
            expected_channels = COALESCE(?, ea_calendar_push_watch_state.expected_channels),
            failure_count = CASE WHEN excluded.last_error IS NULL THEN 0
              ELSE ea_calendar_push_watch_state.failure_count + 1 END`,
    args: [userId, accountId, nowMs, error ? null : nowMs, error, error ? 1 : 0, expectedChannels, expectedChannels],
  });
}

async function retireChannel(dbClient: Client, channel: Channel, nowMs: number, auth?: AuthorizedCalendarAccount) {
  await dbClient.execute({
    sql: "UPDATE ea_calendar_push_channels SET status = 'retired', retired_at = ? WHERE channel_id = ?",
    args: [nowMs, channel.channel_id],
  });
  if (auth && channel.resource_id && Number(channel.expires_at) > nowMs) {
    await googleCalendarFetch(auth, "channels/stop", {
      method: "POST", body: { id: channel.channel_id, resourceId: channel.resource_id },
    }).catch(() => undefined);
  }
}

async function registerChannel(
  dbClient: Client, userId: string, auth: AuthorizedCalendarAccount,
  target: Pick<Channel, "kind" | "calendar_id">, callbackUrl: string, nowMs: number,
) {
  const channelId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = nowMs + WATCH_TTL_MS;
  const inserted = await dbClient.execute({
    sql: `INSERT OR IGNORE INTO ea_calendar_push_channels
            (channel_id, user_id, account_id, kind, calendar_id, callback_url,
             token_hash, status, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    args: [channelId, userId, auth.account.id, target.kind, target.calendar_id, callbackUrl,
      tokenHash(token), nowMs, expiresAt],
  });
  if (!inserted.rowsAffected) return false;
  try {
    const response = await googleCalendarFetch(auth, `${resourcePath(target)}/watch`, {
      method: "POST",
      body: { id: channelId, type: "web_hook", address: callbackUrl, token,
        expiration: String(expiresAt), params: { ttl: String(WATCH_TTL_MS / 1000) } },
    });
    const body = await response.json() as { id?: unknown; resourceId?: unknown; resourceUri?: unknown; expiration?: unknown };
    const expiration = Number(body.expiration);
    if (body.id !== channelId || typeof body.resourceId !== "string" || !body.resourceId
      || body.resourceId.length > 1024 || typeof body.resourceUri !== "string"
      || !resourceUriMatches(body.resourceUri, target)
      || !Number.isSafeInteger(expiration) || expiration <= nowMs) throw new Error("Invalid watch response");
    const result = await dbClient.execute({
      sql: `UPDATE ea_calendar_push_channels SET status = 'active', resource_id = ?, expires_at = ?
            WHERE channel_id = ? AND status = 'pending' AND (resource_id IS NULL OR resource_id = ?)`,
      args: [body.resourceId, Math.min(expiration, expiresAt), channelId, body.resourceId],
    });
    if (!result.rowsAffected) throw new Error("Watch resource changed during registration");
    return true;
  } catch (error) {
    await dbClient.execute({
      sql: "UPDATE ea_calendar_push_channels SET status = 'failed', push_unsupported = ? WHERE channel_id = ? AND status = 'pending'",
      args: [Number(target.kind === "events" && isPushUnsupported(error)), channelId],
    });
    throw error;
  }
}

async function reconcile(userId: string, { dbClient = db, callbackUrl, nowMs = Date.now() }:
  PushOptions & { callbackUrl?: string }): Promise<ReconcileResult> {
  const result = { registered: 0, stopped: 0, failed: 0, skipped: false };
  if (!callbackUrl && process.env.NODE_ENV !== "production") return { ...result, skipped: true };
  const accounts = await configuredAccounts(userId, dbClient);
  const enabledAccounts = accounts.filter(enabled);
  const stored = await dbClient.execute({
    sql: `SELECT * FROM ea_calendar_push_channels WHERE user_id = ?
          AND (status IN ('active', 'pending')
            OR (status = 'failed' AND push_unsupported = 1 AND expires_at > ?))`,
    args: [userId, nowMs],
  });
  const channels = stored.rows as Channel[];
  for (const channel of channels) {
    if (enabledAccounts.some((account) => account.id === channel.account_id)) continue;
    const account = accounts.find((candidate) => candidate.id === channel.account_id);
    const auth = account?.credentials_encrypted
      ? await getAuthorizedAccount(account, { dbClient }).catch(() => undefined) : undefined;
    await retireChannel(dbClient, channel, nowMs, auth);
    result.stopped++;
  }
  try {
    const origin = callbackUrl ? null : await createCanonicalUrlService(dbClient).resolveCanonicalOrigin();
    callbackUrl ||= origin ? new URL("/api/calendar/push", origin).toString() : undefined;
    const callback = new URL(callbackUrl || "");
    if (callback.protocol !== "https:" || callback.username || callback.password || callback.search || callback.hash
      || callback.pathname !== "/api/calendar/push") throw new Error("Invalid callback URL");
  } catch {
    for (const account of enabledAccounts) {
      await recordAttempt(dbClient, userId, account.id, nowMs, "Calendar push needs the public HTTPS application URL.");
    }
    return { ...result, failed: enabledAccounts.length, skipped: true };
  }
  for (const account of enabledAccounts) {
    let failure: string | null = null;
    let expectedChannels: number | null = null;
    try {
      invalidateCalendarListCache(account.id);
      const auth = await getAuthorizedAccount(account, { dbClient });
      const calendars = await listCalendarsForAccount(account, { dbClient, requireComplete: true });
      if (calendars.some((calendar) => calendar.syntheticCalendarListFallback)) throw new Error("Incomplete calendar discovery");
      const targets: Array<Pick<Channel, "kind" | "calendar_id">> = calendars.map((calendar) => ({ kind: "events", calendar_id: calendar.id }));
      if (auth.credentials.scopes?.some((scope) => CALENDAR_LIST_SCOPES.has(scope))) {
        targets.push({ kind: "calendar_list", calendar_id: "" });
      }
      expectedChannels = targets.length;
      const accountChannels = channels.filter((channel) => channel.account_id === account.id);
      for (const channel of accountChannels) {
        if (targets.some((target) => target.kind === channel.kind && target.calendar_id === channel.calendar_id)) continue;
        await retireChannel(dbClient, channel, nowMs, auth);
        result.stopped++;
      }
      for (const target of targets) {
        const previous = accountChannels.filter((channel) => target.kind === channel.kind && target.calendar_id === channel.calendar_id);
        // An explicit provider capability refusal is not an outage. The normal
        // fifteen-minute data sync still includes this calendar. Recheck support
        // after the attempted watch's seven-day lifetime, including after restart.
        if (previous.some((channel) => channel.status === "failed" && channel.push_unsupported === 1)) {
          expectedChannels--;
          continue;
        }
        if (previous.some((channel) => channel.status === "active" && channel.callback_url === callbackUrl
          && Number(channel.expires_at) > nowMs + DAY_MS)) continue;
        if (previous.some((channel) => channel.status === "pending" && Number(channel.created_at) + REGISTRATION_TIMEOUT_MS > nowMs)) continue;
        for (const channel of previous.filter((entry) => entry.status === "pending")) {
          await retireChannel(dbClient, channel, nowMs, auth);
        }
        try {
          if (!await registerChannel(dbClient, userId, auth, target, callbackUrl!, nowMs)) continue;
          result.registered++;
          // Both channel IDs remain admissible during registration. Only a
          // confirmed replacement permits retirement of the previous watch.
          for (const channel of previous.filter((entry) => entry.status === "active")) {
            await retireChannel(dbClient, channel, nowMs, auth);
            result.stopped++;
          }
        } catch (error) {
          if (target.kind === "events" && isPushUnsupported(error)) {
            expectedChannels--;
            continue;
          }
          failure = sanitizedFailure(error);
          result.failed++;
        }
      }
    } catch (error) {
      failure = sanitizedFailure(error);
      result.failed++;
    }
    await recordAttempt(dbClient, userId, account.id, nowMs, failure, expectedChannels);
  }
  await dbClient.execute({
    sql: "DELETE FROM ea_calendar_push_channels WHERE user_id = ? AND expires_at < ?",
    args: [userId, nowMs - 30 * DAY_MS],
  });
  return result;
}

export function reconcileCalendarPushWatches(userId: string, options: PushOptions & { callbackUrl?: string } = {}) {
  const dbClient = options.dbClient || db;
  let pending = reconciliations.get(dbClient);
  if (!pending) { pending = new Map(); reconciliations.set(dbClient, pending); }
  const current = pending.get(userId);
  if (current) return current;
  const work = reconcile(userId, options).finally(() => pending.delete(userId));
  pending.set(userId, work);
  return work;
}

export async function getCalendarPushHealth(userId: string, { dbClient = db, nowMs = Date.now() }: PushOptions = {}): Promise<CalendarPushHealth> {
  const accounts = (await configuredAccounts(userId, dbClient)).filter(enabled);
  const inactive: CalendarPushHealth = { state: "inactive", activeChannels: 0, lastNotificationAt: null };
  if (!accounts.length) return inactive;
  const [watchRows, channelRows, queueRows] = await Promise.all([
    dbClient.execute({ sql: "SELECT * FROM ea_calendar_push_watch_state WHERE user_id = ?", args: [userId] }),
    dbClient.execute({ sql: "SELECT * FROM ea_calendar_push_channels WHERE user_id = ?", args: [userId] }),
    dbClient.execute({ sql: "SELECT last_error FROM ea_calendar_push_sync WHERE user_id = ?", args: [userId] }),
  ]);
  const belongs = (row: Row) => accounts.some((account) => account.id === row.account_id);
  const watches = watchRows.rows.filter(belongs);
  const channels = channelRows.rows.filter(belongs);
  const active = channels.filter((channel) => channel.status === "active" && Number(channel.expires_at) > nowMs);
  const lastNotification = Math.max(0, ...channels.map((channel) => Number(channel.last_notification_at) || 0));
  const evidence = { activeChannels: active.length, lastNotificationAt: lastNotification || null };
  if (queueRows.rows[0]?.last_error) {
    return { state: "degraded", message: "Calendar synchronization failed. Automatic retry is pending.", ...evidence };
  }
  if (process.env.NODE_ENV !== "production" && dbClient === db) return inactive;
  const error = watches.find((watch) => watch.last_error)?.last_error;
  if (error) return { state: "degraded", message: String(error), ...evidence };
  if (!watches.length && !channels.length) return inactive;
  if (accounts.some((account) => {
    const expected = watches.find((watch) => watch.account_id === account.id)?.expected_channels;
    const sources = new Set(active.filter((channel) => channel.account_id === account.id)
      .map((channel) => `${channel.kind}:${channel.calendar_id}`));
    return expected == null || sources.size < Number(expected);
  })) {
    return { state: "degraded", message: "Calendar push subscriptions have expired. Automatic renewal is pending.", ...evidence };
  }
  return { state: "current", ...evidence };
}
