import db from "../db/connection.js";
import { loadUserConfig, fetchAllEmails } from "./index.js";
import { indexEmails } from "./email-index.js";
import { enqueueEmailTriageForEmails } from "./gmail-sync.js";
import { getEmailTriageModeForUser } from "./triage-mode.js";
import { getElapsedMs, logTiming } from "../timing.js";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const TRIAGE_LANES = new Set(["needs_attention", "fyi", "noise"]);
const PROVIDER_REMOVED_STATES = new Set(["archived", "trashed"]);

function localDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    second: Number(parts.second || 0),
  };
}

function utcDateParts(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedMidnightToUtc({ year, month, day }, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMs = timeZoneOffsetMs(guess, timeZone);
  const candidate = new Date(guess.getTime() - offsetMs);
  const adjustedOffsetMs = timeZoneOffsetMs(candidate, timeZone);
  return new Date(guess.getTime() - adjustedOffsetMs);
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = localDateParts(date, timeZone);
  const projectedUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return projectedUtc - date.getTime();
}

export function activeSnapshotWindow({
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  const startLocal = localDateParts(now, timeZone);
  const nextLocal = utcDateParts(new Date(Date.UTC(
    startLocal.year,
    startLocal.month - 1,
    startLocal.day + 1,
  )));
  const start = zonedMidnightToUtc(startLocal, timeZone);
  const end = zonedMidnightToUtc(nextLocal, timeZone);
  return {
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    timezone: timeZone,
  };
}

function normalizeSnapshot(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    snapshot_item_id: Number(row.id),
  };
}

function normalizeCount(value) {
  return Number(value || 0);
}

function normalizeSnapshotItem(row) {
  return {
    id: Number(row.id),
    snapshot_id: Number(row.snapshot_id),
    triage_id: Number(row.triage_id),
    user_id: row.user_id,
    account_id: row.account_id,
    email_id: row.email_id,
    uid: row.email_id,
    lane: row.lane_at_snapshot,
    lane_at_snapshot: row.lane_at_snapshot,
    summary: row.summary_at_snapshot || "",
    preview: row.summary_at_snapshot || "",
    action: row.action_at_snapshot || "",
    urgency: row.urgency_at_snapshot || "normal",
    deadline_at: row.deadline_at_snapshot || null,
    category: row.category_at_snapshot || "uncategorized",
    escalation_badge: row.escalation_badge_at_snapshot || null,
    subject: row.subject_at_snapshot || "",
    from: row.from_name_at_snapshot || row.from_address_at_snapshot || "",
    from_name: row.from_name_at_snapshot || "",
    from_address: row.from_address_at_snapshot || "",
    date: row.email_date_at_snapshot || null,
    email_date: row.email_date_at_snapshot || null,
    account_label: row.account_label_at_snapshot || "",
    account_email: row.account_email_at_snapshot || "",
    account_color: row.account_color_at_snapshot || "#818cf8",
    account_icon: row.account_icon_at_snapshot || "Mail",
    sort_order: Number(row.sort_order || 0),
    is_carryover: Boolean(row.is_carryover),
    dismissed_from_today_at: row.dismissed_from_today_at || null,
    handled_at: row.handled_at || null,
    provider_removed_at: row.provider_removed_at || null,
    read: Boolean(row.read),
    hasBill: Boolean(row.bill_candidate_json),
    bill_candidate: row.bill_candidate_json ? JSON.parse(row.bill_candidate_json) : null,
  };
}

async function findActiveSnapshot(dbClient, userId, window) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
            AND start_at = ?
            AND end_at = ?
            AND status = 'active'
          LIMIT 1`,
    args: [userId, window.start_at, window.end_at],
  });
  return normalizeSnapshot(result.rows[0]);
}

async function findContainingActiveSnapshot(dbClient, userId, now) {
  const nowIso = now.toISOString();
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
            AND status = 'active'
            AND start_at <= ?
            AND end_at > ?
          ORDER BY start_at DESC
          LIMIT 1`,
    args: [userId, nowIso, nowIso],
  });
  return normalizeSnapshot(result.rows[0]);
}

async function freezeExpiredActiveSnapshots(dbClient, userId, window, now) {
  await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshots
          SET status = 'frozen',
              frozen_at = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND status = 'active'
            AND end_at <= ?`,
    args: [now.toISOString(), userId, window.start_at],
  });
}

async function freezeActiveSnapshotsAtBoundary(dbClient, userId, now) {
  const nowIso = now.toISOString();
  await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshots
          SET status = 'frozen',
              end_at = ?,
              frozen_at = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND status = 'active'
            AND start_at < ?
            AND end_at > ?`,
    args: [nowIso, nowIso, userId, nowIso, nowIso],
  });
}

async function loadPreviousFrozenSnapshot(dbClient, userId, window) {
  const result = await dbClient.execute({
    sql: `SELECT *
          FROM ea_briefing_snapshots
          WHERE user_id = ?
            AND status = 'frozen'
            AND end_at <= ?
          ORDER BY end_at DESC
          LIMIT 1`,
    args: [userId, window.start_at],
  });
  return normalizeSnapshot(result.rows[0]);
}

async function copyCarryoverItems(dbClient, userId, snapshot, window) {
  const previous = await loadPreviousFrozenSnapshot(dbClient, userId, window);
  if (!previous) return;

  await dbClient.execute({
    sql: `INSERT OR IGNORE INTO ea_briefing_snapshot_items
            (snapshot_id, triage_id, user_id, account_id, email_id,
             lane_at_snapshot, summary_at_snapshot, action_at_snapshot,
             urgency_at_snapshot, deadline_at_snapshot, category_at_snapshot,
             escalation_badge_at_snapshot, subject_at_snapshot,
             from_name_at_snapshot, from_address_at_snapshot, email_date_at_snapshot,
             account_label_at_snapshot, account_email_at_snapshot,
             account_color_at_snapshot, account_icon_at_snapshot, sort_order,
             is_carryover)
          SELECT ?, i.triage_id, i.user_id, i.account_id, i.email_id,
                 'needs_attention', i.summary_at_snapshot, i.action_at_snapshot,
                 i.urgency_at_snapshot, i.deadline_at_snapshot, i.category_at_snapshot,
                 i.escalation_badge_at_snapshot, i.subject_at_snapshot,
                 i.from_name_at_snapshot, i.from_address_at_snapshot, i.email_date_at_snapshot,
                 i.account_label_at_snapshot, i.account_email_at_snapshot,
                 i.account_color_at_snapshot, i.account_icon_at_snapshot, i.sort_order,
                 1
          FROM ea_briefing_snapshot_items i
          JOIN ea_email_triage t
            ON t.id = i.triage_id
           AND t.user_id = i.user_id
          WHERE i.snapshot_id = ?
            AND i.user_id = ?
            AND i.lane_at_snapshot = 'needs_attention'
            AND i.dismissed_from_today_at IS NULL
            AND i.handled_at IS NULL
            AND i.provider_removed_at IS NULL
            AND t.lane = 'needs_attention'
            AND t.handled_at IS NULL
            AND t.dismissed_at IS NULL
            AND t.provider_state = 'available'`,
    args: [snapshot.id, previous.id, userId],
  });
}

export async function getOrCreateActiveSnapshot(userId, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  const window = activeSnapshotWindow({ now, timeZone });
  await freezeExpiredActiveSnapshots(dbClient, userId, window, now);

  const containing = await findContainingActiveSnapshot(dbClient, userId, now);
  if (containing) return containing;

  const existing = await findActiveSnapshot(dbClient, userId, window);
  if (existing) return existing;

  await dbClient.execute({
    sql: `INSERT OR IGNORE INTO ea_briefing_snapshots
            (user_id, start_at, end_at, timezone, status)
          VALUES (?, ?, ?, ?, 'active')`,
    args: [userId, window.start_at, window.end_at, window.timezone],
  });

  const created = await findActiveSnapshot(dbClient, userId, window);
  if (created) await copyCarryoverItems(dbClient, userId, created, window);
  return created;
}

export async function advanceSnapshotBoundary(userId, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  scheduleLabel = null,
} = {}) {
  const nowIso = now.toISOString();
  const dailyWindow = activeSnapshotWindow({ now, timeZone });
  const window = {
    start_at: nowIso,
    end_at: dailyWindow.end_at,
    timezone: timeZone,
  };

  await freezeActiveSnapshotsAtBoundary(dbClient, userId, now);

  const existing = await findActiveSnapshot(dbClient, userId, window);
  if (!existing) {
    await dbClient.execute({
      sql: `INSERT OR IGNORE INTO ea_briefing_snapshots
              (user_id, start_at, end_at, timezone, status)
            VALUES (?, ?, ?, ?, 'active')`,
      args: [userId, window.start_at, window.end_at, window.timezone],
    });
  }

  const snapshot = await findActiveSnapshot(dbClient, userId, window);
  if (snapshot) await copyCarryoverItems(dbClient, userId, snapshot, window);
  return {
    snapshot,
    schedule_label: scheduleLabel,
  };
}

async function loadSnapshotItems(dbClient, snapshotId) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 idx.read,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          LEFT JOIN ea_email_index idx
            ON idx.user_id = i.user_id
           AND idx.account_id = i.account_id
           AND idx.uid = i.email_id
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.snapshot_id = ?
            AND i.dismissed_from_today_at IS NULL
            AND i.provider_removed_at IS NULL
            AND i.handled_at IS NULL
          ORDER BY i.is_carryover DESC, i.sort_order ASC, i.email_date_at_snapshot DESC, i.id ASC`,
    args: [snapshotId],
  });
  return result.rows.map(normalizeSnapshotItem);
}

async function loadActiveSnapshotItem(dbClient, userId, itemId) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 idx.read,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          JOIN ea_briefing_snapshots s
            ON s.id = i.snapshot_id
           AND s.status = 'active'
          LEFT JOIN ea_email_index idx
            ON idx.user_id = i.user_id
           AND idx.account_id = i.account_id
           AND idx.uid = i.email_id
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.id = ?
            AND i.user_id = ?
            AND i.dismissed_from_today_at IS NULL
            AND i.provider_removed_at IS NULL
            AND i.handled_at IS NULL
          LIMIT 1`,
    args: [itemId, userId],
  });
  return result.rows[0] || null;
}

async function loadSnapshotItemById(dbClient, userId, itemId) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 idx.read,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          LEFT JOIN ea_email_index idx
            ON idx.user_id = i.user_id
           AND idx.account_id = i.account_id
           AND idx.uid = i.email_id
          LEFT JOIN ea_email_triage t
            ON t.id = i.triage_id
          WHERE i.id = ?
            AND i.user_id = ?
          LIMIT 1`,
    args: [itemId, userId],
  });
  return result.rows[0] || null;
}

async function loadActiveSnapshotItemsForEmail(dbClient, userId, accountId, emailId) {
  const result = await dbClient.execute({
    sql: `SELECT i.*,
                 t.provider_state,
                 t.bill_candidate_json
          FROM ea_briefing_snapshot_items i
          JOIN ea_briefing_snapshots s
            ON s.id = i.snapshot_id
           AND s.status = 'active'
          JOIN ea_email_triage t
            ON t.id = i.triage_id
           AND t.user_id = i.user_id
          WHERE i.user_id = ?
            AND i.account_id = ?
            AND i.email_id = ?
            AND i.provider_removed_at IS NULL`,
    args: [userId, accountId, emailId],
  });
  return result.rows;
}

function makeHttpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function insertFeedback(dbClient, item, feedbackType, fromValue, toValue) {
  await dbClient.execute({
    sql: `INSERT INTO ea_triage_feedback
            (user_id, triage_id, snapshot_item_id, account_id, email_id,
             feedback_type, from_value, to_value)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      item.user_id,
      item.triage_id,
      item.id,
      item.account_id,
      item.email_id,
      feedbackType,
      fromValue,
      toValue,
    ],
  });
}

async function loadProcessingState(dbClient, userId) {
  const result = await dbClient.execute({
    sql: `SELECT job_type, status, COUNT(*) AS count
          FROM ea_triage_jobs
          WHERE user_id = ?
            AND job_type IN ('email_triage', 'gmail_history_sync')
            AND status IN ('queued', 'running')
          GROUP BY job_type, status`,
    args: [userId],
  });
  const countsByType = {
    email_triage: { pending: 0, queued: 0, running: 0, total: 0, active: false },
    gmail_history_sync: { pending: 0, queued: 0, running: 0, total: 0, active: false },
  };
  for (const row of result.rows) {
    const type = countsByType[row.job_type];
    if (!type) continue;
    if (row.status === "queued") {
      type.pending = normalizeCount(row.count);
      type.queued = type.pending;
    }
    if (row.status === "running") type.running = normalizeCount(row.count);
  }
  for (const type of Object.values(countsByType)) {
    type.total = type.pending + type.running;
    type.active = type.total > 0;
  }
  const mode = await getEmailTriageModeForUser(userId, { dbClient });
  const emailTriage = countsByType.email_triage;
  return {
    queued: emailTriage.queued,
    running: emailTriage.running,
    total: emailTriage.total,
    active: emailTriage.active || countsByType.gmail_history_sync.active,
    ...mode,
    email_triage: countsByType.email_triage,
    gmail_history_sync: countsByType.gmail_history_sync,
  };
}

async function defaultProcessNextEmailTriageJob(options) {
  const { processNextEmailTriageJob } = await import("./triage-worker.js");
  return processNextEmailTriageJob(options);
}

async function timeSnapshotSyncSource(source, work, extra = {}) {
  const startedAt = performance.now();
  try {
    const result = await work();
    logTiming({
      event: "snapshot-sync-source",
      source,
      ms: getElapsedMs(startedAt),
      status: "ok",
      ...(typeof extra === "function" ? extra(result) : extra),
    });
    return result;
  } catch (err) {
    logTiming({
      event: "snapshot-sync-source",
      source,
      ms: getElapsedMs(startedAt),
      status: "error",
      error: err?.message || String(err),
      ...(typeof extra === "function" ? extra(null, err) : extra),
    }, console.error);
    throw err;
  }
}

function buildFilters(items) {
  const accountMap = new Map();
  const categoryMap = new Map();

  for (const item of items) {
    const existingAccount = accountMap.get(item.account_id);
    if (existingAccount) {
      existingAccount.count += 1;
    } else {
      accountMap.set(item.account_id, {
        account_id: item.account_id,
        label: item.account_label,
        email: item.account_email,
        color: item.account_color,
        icon: item.account_icon,
        count: 1,
      });
    }

    const category = item.category || "uncategorized";
    categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
  }

  return {
    accounts: [...accountMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    categories: [...categoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category)),
  };
}

function buildLanes(items) {
  const lanes = {
    needs_attention: [],
    fyi: [],
    noise: [],
  };
  const carryover = [];

  for (const item of items) {
    if (item.is_carryover) {
      carryover.push(item);
      continue;
    }
    if (lanes[item.lane]) lanes[item.lane].push(item);
  }

  return { lanes, carryover };
}

export async function getActiveSnapshotView(userId, {
  dbClient = db,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  const snapshot = await getOrCreateActiveSnapshot(userId, { dbClient, now, timeZone });
  const items = snapshot ? await loadSnapshotItems(dbClient, snapshot.id) : [];
  const { lanes, carryover } = buildLanes(items);
  const processing = await loadProcessingState(dbClient, userId);

  return {
    snapshot,
    lanes,
    carryover,
    laneCounts: {
      needs_attention: lanes.needs_attention.length,
      fyi: lanes.fyi.length,
      noise: lanes.noise.length,
      carryover: carryover.length,
    },
    processing,
    filters: buildFilters(items),
  };
}

export async function syncActiveSnapshot(userId, {
  dbClient = db,
  loadUserConfigFn = loadUserConfig,
  fetchAllEmailsFn = fetchAllEmails,
  indexEmailsFn = indexEmails,
  enqueueEmailTriageForEmailsFn = enqueueEmailTriageForEmails,
  processNextEmailTriageJobFn = defaultProcessNextEmailTriageJob,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
} = {}) {
  const { accounts, settings } = await timeSnapshotSyncSource("config", () => loadUserConfigFn(userId), (result) => ({
    accounts: result?.accounts?.length || 0,
  }));
  const hoursBack = Number(settings?.email_lookback_hours) || 16;
  const emails = await timeSnapshotSyncSource("emailFetch", () => fetchAllEmailsFn(accounts, hoursBack), (result) => ({
    accounts: accounts.length,
    emails: result?.length || 0,
    hoursBack,
  }));

  if (emails.length) {
    await timeSnapshotSyncSource("indexAndEnqueue", async () => {
      await indexEmailsFn(userId, emails);
      await enqueueEmailTriageForEmailsFn(userId, emails, { dbClient });
    }, {
      emails: emails.length,
    });
  }

  await timeSnapshotSyncSource("triageLoop", async () => {
    let processed = 0;
    let paused = false;
    for (let i = 0; i < 25; i++) {
      const result = await processNextEmailTriageJobFn({ dbClient, now });
      if (result?.paused) {
        paused = true;
        break;
      }
      if (!result?.processed) break;
      processed++;
    }
    return { processed, paused };
  }, (result) => ({
    processed: result?.processed || 0,
    paused: !!result?.paused,
    limit: 25,
  }));

  return timeSnapshotSyncSource("snapshotView", () => getActiveSnapshotView(userId, { dbClient, now, timeZone }), (result) => ({
    items: Object.values(result?.laneCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0),
    processingActive: !!result?.processing?.active,
  }));
}

export async function moveSnapshotItemLane(userId, itemId, lane, {
  dbClient = db,
} = {}) {
  if (!TRIAGE_LANES.has(lane)) {
    throw makeHttpError("Invalid snapshot lane", 400);
  }

  const item = await loadActiveSnapshotItem(dbClient, userId, itemId);
  if (!item) {
    throw makeHttpError("Active snapshot item not found", 404);
  }
  if (item.lane_at_snapshot === lane) {
    return normalizeSnapshotItem(item);
  }

  await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshot_items
          SET lane_at_snapshot = ?,
              is_carryover = 0,
              updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [lane, itemId, userId],
  });
  await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET lane = ?,
              updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [lane, item.triage_id, userId],
  });
  await insertFeedback(dbClient, item, "lane_move", item.lane_at_snapshot, lane);

  const updated = await loadActiveSnapshotItem(dbClient, userId, itemId);
  return normalizeSnapshotItem(updated);
}

export async function dismissSnapshotItemForToday(userId, itemId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const item = await loadActiveSnapshotItem(dbClient, userId, itemId);
  if (!item) {
    throw makeHttpError("Active snapshot item not found", 404);
  }

  const dismissedAt = now.toISOString();
  await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshot_items
          SET dismissed_from_today_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [dismissedAt, itemId, userId],
  });
  await insertFeedback(dbClient, item, "dismiss_today", "visible", "dismissed");

  const updated = await loadSnapshotItemById(dbClient, userId, itemId);
  return normalizeSnapshotItem(updated);
}

export async function markSnapshotItemHandled(userId, itemId, {
  dbClient = db,
  now = new Date(),
} = {}) {
  const item = await loadActiveSnapshotItem(dbClient, userId, itemId);
  if (!item) {
    throw makeHttpError("Active snapshot item not found", 404);
  }

  const handledAt = now.toISOString();
  await dbClient.execute({
    sql: `UPDATE ea_briefing_snapshot_items
          SET handled_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [handledAt, itemId, userId],
  });
  await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET handled_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [handledAt, item.triage_id, userId],
  });
  await insertFeedback(dbClient, item, "mark_handled", "unhandled", "handled");

  const updated = await loadSnapshotItemById(dbClient, userId, itemId);
  return normalizeSnapshotItem(updated);
}

export async function markProviderRemovedFromActiveSnapshots(
  userId,
  accountId,
  emailId,
  providerState,
  {
    dbClient = db,
    now = new Date(),
  } = {},
) {
  if (!PROVIDER_REMOVED_STATES.has(providerState)) {
    throw makeHttpError("Invalid provider removal state", 400);
  }

  const items = await loadActiveSnapshotItemsForEmail(dbClient, userId, accountId, emailId);
  const removedAt = now.toISOString();

  await dbClient.execute({
    sql: `UPDATE ea_email_triage
          SET provider_state = ?,
              updated_at = datetime('now')
          WHERE user_id = ?
            AND account_id = ?
            AND email_id = ?`,
    args: [providerState, userId, accountId, emailId],
  });

  if (items.length) {
    await dbClient.execute({
      sql: `UPDATE ea_briefing_snapshot_items
            SET provider_removed_at = ?,
                updated_at = datetime('now')
            WHERE user_id = ?
              AND account_id = ?
              AND email_id = ?
              AND snapshot_id IN (
                SELECT id FROM ea_briefing_snapshots
                WHERE user_id = ? AND status = 'active'
              )
              AND provider_removed_at IS NULL`,
      args: [removedAt, userId, accountId, emailId, userId],
    });

    for (const item of items) {
      await insertFeedback(
        dbClient,
        item,
        "provider_removed",
        item.provider_state || "available",
        providerState,
      );
    }
  }

  return { updated: items.length };
}
