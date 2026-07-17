import crypto from "crypto";
import db from "../db/connection.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.js";
import {
  getTodoistMirrorHealth,
  recordTodoistSyncRequest,
  syncTodoistMirror,
} from "./todoist-mirror.js";

const DEFAULT_DEBOUNCE_MS = 1000;
export const TODOIST_SYNC_BACKSTOP_MS = 5 * 60 * 1000;
export const TODOIST_WEBHOOK_DELIVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const pendingSyncs = new Map();
const activeSyncs = new Map();
let backstopTimer = null;

function iso(now) {
  return now.toISOString();
}

function firstHeader(headers, name) {
  const value = headers?.[name] || headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqualBase64(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a).trim(), "base64");
  const right = Buffer.from(String(b).trim(), "base64");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyTodoistWebhookSignature(rawBody, signature, clientSecret) {
  if (!clientSecret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", clientSecret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || ""))
    .digest("base64");
  return safeEqualBase64(signature, expected);
}

function parsePayload(rawBody) {
  const payloadJson = Buffer.isBuffer(rawBody)
    ? rawBody.toString("utf8")
    : String(rawBody || "");
  try {
    return {
      payloadJson,
      payload: JSON.parse(payloadJson || "{}"),
    };
  } catch {
    return {
      payloadJson,
      payload: {},
    };
  }
}

export async function recordTodoistWebhookDelivery({
  userId,
  deliveryId,
  eventName,
  payloadJson,
  dbClient = db,
  now = new Date(),
}) {
  const result = await dbClient.execute({
    sql: `INSERT OR IGNORE INTO ea_todoist_webhook_deliveries
            (delivery_id, user_id, event_name, payload_json, received_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [deliveryId, userId, eventName || null, payloadJson || "{}", iso(now)],
  });
  return { inserted: Number(result.rowsAffected || 0) > 0 };
}

export async function cleanupTodoistWebhookDeliveries({
  dbClient = db,
  now = new Date(),
  ttlMs = TODOIST_WEBHOOK_DELIVERY_TTL_MS,
} = {}) {
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  const result = await dbClient.execute({
    sql: "DELETE FROM ea_todoist_webhook_deliveries WHERE received_at < ?",
    args: [cutoff],
  });
  return { deleted: Number(result.rowsAffected || 0) };
}

async function runRequestedSync(userId, {
  syncFn,
} = {}) {
  const sync = syncFn || syncTodoistMirror;
  const requested = pendingSyncs.get(userId);
  if (!requested || activeSyncs.has(userId)) return;

  pendingSyncs.delete(userId);
  let settledState = "current";
  const active = Promise.resolve()
    .then(() => sync(userId, { forceFull: !!requested.forceFull }))
    .then((result) => {
      settledState = result?.status || "current";
      return result;
    })
    .catch((err) => {
      console.error("[Todoist] requested mirror sync failed:", err.message);
      settledState = "degraded";
      return null;
    })
    .finally(() => {
      publishCurrentDashboardEvent(userId, {
        source: "todoist",
        reason: "sync_settled",
        state: settledState,
      });
      activeSyncs.delete(userId);
      if (pendingSyncs.has(userId)) {
        scheduleRequestedSync(userId, { delayMs: 0, syncFn: sync });
      }
    });
  activeSyncs.set(userId, active);
}

function scheduleRequestedSync(userId, {
  delayMs,
  syncFn,
} = {}) {
  const pending = pendingSyncs.get(userId);
  if (!pending || pending.timer || activeSyncs.has(userId)) return;

  pending.timer = setTimeout(() => {
    const next = pendingSyncs.get(userId);
    if (next) next.timer = null;
    runRequestedSync(userId, { syncFn });
  }, delayMs);
  pending.timer.unref?.();
}

export function requestTodoistMirrorSync(userId, {
  reason = "manual",
  debounceMs = DEFAULT_DEBOUNCE_MS,
  forceFull = false,
  syncFn,
} = {}) {
  if (!userId) return { queued: false };
  const existing = pendingSyncs.get(userId);
  if (existing) {
    existing.reason = reason;
    existing.forceFull = existing.forceFull || forceFull;
    return { queued: true, coalesced: true };
  }

  pendingSyncs.set(userId, {
    reason,
    forceFull,
    timer: null,
  });
  scheduleRequestedSync(userId, { delayMs: debounceMs, syncFn });
  return { queued: true, coalesced: false };
}

export async function handleTodoistWebhookDelivery({
  userId,
  rawBody,
  headers,
  clientSecret = process.env.TODOIST_CLIENT_SECRET,
  dbClient = db,
  requestSync = requestTodoistMirrorSync,
  now = new Date(),
} = {}) {
  const signature = firstHeader(headers, "x-todoist-hmac-sha256");
  const deliveryId = firstHeader(headers, "x-todoist-delivery-id");

  if (!verifyTodoistWebhookSignature(rawBody, signature, clientSecret)) {
    const err = new Error("Invalid Todoist webhook signature");
    err.status = clientSecret ? 401 : process.env.NODE_ENV === "production" ? 503 : 401;
    throw err;
  }
  if (!deliveryId) {
    const err = new Error("Missing Todoist delivery id");
    err.status = 400;
    throw err;
  }

  const { payloadJson, payload } = parsePayload(rawBody);
  const record = await recordTodoistWebhookDelivery({
    userId,
    deliveryId,
    eventName: payload.event_name,
    payloadJson,
    dbClient,
    now,
  });

  if (!record.inserted) {
    return { accepted: true, duplicate: true };
  }

  await recordTodoistSyncRequest(userId, {
    dbClient,
    reason: "todoist-webhook",
    now,
  });
  requestSync(userId, { reason: "todoist-webhook" });
  return { accepted: true, duplicate: false };
}

async function requestStartupSyncIfNeeded(userId, {
  getHealthFn = getTodoistMirrorHealth,
  requestSyncFn = requestTodoistMirrorSync,
} = {}) {
  if (!userId) return;
  const health = await getHealthFn(userId);
  if (!health.configured || health.state === "current" || health.state === "syncing") return;
  requestSyncFn(userId, {
    reason: "todoist-startup",
    debounceMs: 0,
    forceFull: !health.lastSuccessAt,
  });
}

export function startTodoistMirrorSyncWorker({
  userId = process.env.EA_USER_ID,
  intervalMs = TODOIST_SYNC_BACKSTOP_MS,
  getHealthFn = getTodoistMirrorHealth,
  requestSyncFn = requestTodoistMirrorSync,
  cleanupFn = cleanupTodoistWebhookDeliveries,
} = {}) {
  if (!userId || backstopTimer) return { started: false };

  requestStartupSyncIfNeeded(userId, { getHealthFn, requestSyncFn })
    .catch((err) => console.error("[Todoist] startup mirror sync check failed:", err.message));
  cleanupFn()
    .catch((err) => console.error("[Todoist] webhook delivery cleanup failed:", err.message));

  backstopTimer = setInterval(() => {
    requestSyncFn(userId, {
      reason: "todoist-backstop",
    });
    cleanupFn()
      .catch((err) => console.error("[Todoist] webhook delivery cleanup failed:", err.message));
  }, intervalMs);
  backstopTimer.unref?.();
  console.log("[Todoist] Mirror sync worker started (every 5 minutes)");
  return { started: true };
}

export function stopTodoistMirrorSyncWorker() {
  if (backstopTimer) {
    clearInterval(backstopTimer);
    backstopTimer = null;
  }
  for (const pending of pendingSyncs.values()) {
    if (pending.timer) clearTimeout(pending.timer);
  }
  pendingSyncs.clear();
  activeSyncs.clear();
}

export const __testing__ = {
  requestStartupSyncIfNeeded,
  runRequestedSync,
};
