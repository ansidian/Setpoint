import crypto from "crypto";
import db from "../db/connection.ts";
import { publishCurrentDashboardEvent } from "../dashboard/current-events.ts";
import {
  getTodoistMirrorHealth,
  recordTodoistSyncRequest,
  syncTodoistMirror,
} from "./todoist-mirror.ts";
import type { Client } from "@libsql/client";
import type { IncomingHttpHeaders } from "node:http";
import type { TodoistMirrorHealth } from "../../shared/types/tasks.ts";
import type { TodoistMirrorSyncResult } from "./todoist-mirror.ts";
import { todoistOAuthCredentialManager } from "./todoist-oauth-credentials.ts";

type TodoistWebhookDb = Client;
type TodoistSyncFn = (userId: string, options?: { forceFull?: boolean }) => Promise<TodoistMirrorSyncResult | Record<string, unknown> | null>;
type TodoistRequestSyncFn = (userId: string, options?: TodoistRequestSyncOptions) => { queued: boolean; coalesced?: boolean };
type TodoistHealthProbe = Pick<TodoistMirrorHealth, "configured" | "state"> & Partial<TodoistMirrorHealth>;

interface TodoistRequestSyncOptions {
  reason?: string;
  debounceMs?: number;
  forceFull?: boolean;
  syncFn?: TodoistSyncFn;
}

interface PendingSync {
  reason: string;
  forceFull: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  syncFn?: TodoistSyncFn;
}

interface TodoistWebhookPayload extends Record<string, unknown> {
  event_name?: string;
}

class TodoistWebhookError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_DEBOUNCE_MS = 1000;
export const TODOIST_SYNC_BACKSTOP_MS = 5 * 60 * 1000;
export const TODOIST_WEBHOOK_DELIVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const pendingSyncs = new Map<string, PendingSync>();
const activeSyncs = new Map<string, Promise<unknown>>();
let backstopTimer: ReturnType<typeof setInterval> | null = null;

function iso(now: Date): string {
  return now.toISOString();
}

function firstHeader(headers: IncomingHttpHeaders | Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const value = headers?.[name] || headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqualBase64(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(String(a).trim(), "base64");
  const right = Buffer.from(String(b).trim(), "base64");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyTodoistWebhookSignature(rawBody: Buffer | string | undefined, signature: string | undefined, clientSecret: string | undefined): boolean {
  if (!clientSecret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", clientSecret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || ""))
    .digest("base64");
  return safeEqualBase64(signature, expected);
}

function parsePayload(rawBody: Buffer | string | undefined): { payloadJson: string; payload: TodoistWebhookPayload } {
  const payloadJson = Buffer.isBuffer(rawBody)
    ? rawBody.toString("utf8")
    : String(rawBody || "");
  try {
    return {
      payloadJson,
      payload: JSON.parse(payloadJson || "{}") as TodoistWebhookPayload,
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
}: {
  userId: string;
  deliveryId: string;
  eventName?: string;
  payloadJson: string;
  dbClient?: TodoistWebhookDb;
  now?: Date;
}): Promise<{ inserted: boolean }> {
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
}: { dbClient?: TodoistWebhookDb; now?: Date; ttlMs?: number } = {}): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  const result = await dbClient.execute({
    sql: "DELETE FROM ea_todoist_webhook_deliveries WHERE received_at < ?",
    args: [cutoff],
  });
  return { deleted: Number(result.rowsAffected || 0) };
}

async function runRequestedSync(userId: string, {
  syncFn,
}: { syncFn?: TodoistSyncFn } = {}): Promise<void> {
  const sync = syncFn || syncTodoistMirror;
  const requested = pendingSyncs.get(userId);
  if (!requested || activeSyncs.has(userId)) return;

  pendingSyncs.delete(userId);
  let settledState = "current";
  const active = Promise.resolve()
    .then(() => sync(userId, { forceFull: !!requested.forceFull }))
    .then((result) => {
      settledState = result && typeof result.status === "string" ? result.status : "current";
      return result;
    })
    .catch((err) => {
      console.error("[Todoist] requested mirror sync failed:", errorMessage(err));
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

function scheduleRequestedSync(userId: string, {
  delayMs,
  syncFn,
}: { delayMs: number; syncFn?: TodoistSyncFn }): void {
  const pending = pendingSyncs.get(userId);
  if (!pending || pending.timer || activeSyncs.has(userId)) return;

  pending.timer = setTimeout(() => {
    const next = pendingSyncs.get(userId);
    if (next) next.timer = null;
    runRequestedSync(userId, { syncFn });
  }, delayMs);
  pending.timer.unref?.();
}

export function requestTodoistMirrorSync(userId: string, {
  reason = "manual",
  debounceMs = DEFAULT_DEBOUNCE_MS,
  forceFull = false,
  syncFn,
}: TodoistRequestSyncOptions = {}): { queued: boolean; coalesced?: boolean } {
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
  clientSecret,
  resolveClientSecret = async () => (await todoistOAuthCredentialManager.resolveActive()).clientSecret,
  dbClient = db,
  requestSync = requestTodoistMirrorSync,
  now = new Date(),
}: {
  userId?: string;
  rawBody?: Buffer | string;
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  clientSecret?: string;
  resolveClientSecret?: () => Promise<string>;
  dbClient?: TodoistWebhookDb;
  requestSync?: TodoistRequestSyncFn;
  now?: Date;
} = {}): Promise<{ accepted: true; duplicate: boolean }> {
  const signature = firstHeader(headers, "x-todoist-hmac-sha256");
  const deliveryId = firstHeader(headers, "x-todoist-delivery-id");

  let currentClientSecret = clientSecret;
  if (currentClientSecret === undefined) {
    try {
      currentClientSecret = await resolveClientSecret();
    } catch {
      throw new TodoistWebhookError("Todoist webhook client secret is not configured", 503);
    }
  }

  if (!verifyTodoistWebhookSignature(rawBody, signature, currentClientSecret)) {
    throw new TodoistWebhookError(
      "Invalid Todoist webhook signature",
      currentClientSecret ? 401 : process.env.NODE_ENV === "production" ? 503 : 401,
    );
  }
  if (!deliveryId) {
    throw new TodoistWebhookError("Missing Todoist delivery id", 400);
  }

  const { payloadJson, payload } = parsePayload(rawBody);
  const record = await recordTodoistWebhookDelivery({
    userId: userId!,
    deliveryId,
    eventName: payload.event_name,
    payloadJson,
    dbClient,
    now,
  });

  if (!record.inserted) {
    return { accepted: true, duplicate: true };
  }

  await recordTodoistSyncRequest(userId!, {
    dbClient,
    reason: "todoist-webhook",
    now,
  });
  requestSync(userId!, { reason: "todoist-webhook" });
  return { accepted: true, duplicate: false };
}

async function requestStartupSyncIfNeeded(userId: string, {
  getHealthFn = getTodoistMirrorHealth,
  requestSyncFn = requestTodoistMirrorSync,
}: {
  getHealthFn?: (userId: string) => Promise<TodoistHealthProbe>;
  requestSyncFn?: TodoistRequestSyncFn;
} = {}): Promise<void> {
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
}: {
  userId?: string;
  intervalMs?: number;
  getHealthFn?: (userId: string) => Promise<TodoistHealthProbe>;
  requestSyncFn?: TodoistRequestSyncFn;
  cleanupFn?: () => Promise<unknown>;
} = {}): { started: boolean } {
  if (!userId || backstopTimer) return { started: false };

  requestStartupSyncIfNeeded(userId, { getHealthFn, requestSyncFn })
    .catch((err) => console.error("[Todoist] startup mirror sync check failed:", errorMessage(err)));
  cleanupFn()
    .catch((err) => console.error("[Todoist] webhook delivery cleanup failed:", errorMessage(err)));

  backstopTimer = setInterval(() => {
    requestSyncFn(userId, {
      reason: "todoist-backstop",
    });
    cleanupFn()
      .catch((err) => console.error("[Todoist] webhook delivery cleanup failed:", errorMessage(err)));
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
