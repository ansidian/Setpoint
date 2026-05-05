import db from "../db/connection.js";
import { generateBriefing, quickRefresh } from "./index.js";
import * as storedBriefingService from "./stored-briefing-service.js";

function legacyRuntimeRetired(message) {
  const err = new Error(message);
  err.status = 410;
  return err;
}

function legacyBriefingRuntimeEnabled() {
  return process.env.NODE_ENV !== "production";
}

export async function triggerGeneration(userId) {
  if (!legacyBriefingRuntimeEnabled()) {
    throw legacyRuntimeRetired("Legacy briefing generation is retired");
  }
  generateBriefing(userId).catch((err) =>
    console.error("[Briefing] Generation failed:", err.message),
  );
  await new Promise((r) => setTimeout(r, 100));
  const latest = await db.execute({
    sql: `SELECT id FROM ea_briefings WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    args: [userId],
  });
  return { id: latest.rows[0]?.id, status: "generating" };
}

export async function getInProgress(userId) {
  if (!legacyBriefingRuntimeEnabled()) {
    return { generating: false, retired: true };
  }
  const result = await db.execute({
    sql: `SELECT id, progress FROM ea_briefings
          WHERE user_id = ? AND status = 'generating'
          ORDER BY id DESC LIMIT 1`,
    args: [userId],
  });
  if (!result.rows.length) return { generating: false };
  return { generating: true, id: result.rows[0].id, progress: result.rows[0].progress };
}

export async function refresh(userId) {
  if (!legacyBriefingRuntimeEnabled()) {
    throw legacyRuntimeRetired("Legacy briefing refresh is retired");
  }
  const result = await quickRefresh(userId);
  result.briefingJson = await storedBriefingService.mergeAccountPrefs(result.briefingJson, userId);
  return result;
}

export async function getLatest(userId) {
  const result = await db.execute({
    sql: `SELECT id, status, briefing_json, generated_at, generation_time_ms
          FROM ea_briefings
          WHERE user_id = ? AND status = 'ready'
          ORDER BY generated_at DESC LIMIT 1`,
    args: [userId],
  });

  if (!result.rows.length) {
    return { briefing: null };
  }

  const row = result.rows[0];
  const briefing = await storedBriefingService.mergeAccountPrefs(
    JSON.parse(row.briefing_json),
    userId,
  );
  return {
    id: row.id,
    status: row.status,
    briefing,
    generated_at: row.generated_at,
    generation_time_ms: row.generation_time_ms,
  };
}

export async function getHistory(userId, { limit = 20 } = {}) {
  const result = await db.execute({
    sql: `SELECT id, status, generated_at, generation_time_ms, error_message,
          json_extract(briefing_json, '$.skippedAI') as skipped_ai
          FROM ea_briefings WHERE user_id = ?
          ORDER BY generated_at DESC LIMIT ?`,
    args: [userId, limit],
  });
  return result.rows;
}

export async function getStatus(userId, id) {
  if (!legacyBriefingRuntimeEnabled()) {
    throw legacyRuntimeRetired("Legacy briefing status polling is retired");
  }
  const result = await db.execute({
    sql: `SELECT id, status, error_message, generation_time_ms, progress
          FROM ea_briefings WHERE id = ? AND user_id = ?`,
    args: [id, userId],
  });
  if (!result.rows.length) {
    const err = new Error("Briefing not found");
    err.status = 404;
    throw err;
  }
  return result.rows[0];
}

export async function getById(userId, id) {
  const result = await db.execute({
    sql: `SELECT id, status, briefing_json, generated_at, generation_time_ms
          FROM ea_briefings WHERE id = ? AND user_id = ? AND status = 'ready'`,
    args: [id, userId],
  });
  if (!result.rows.length) {
    const err = new Error("Briefing not found");
    err.status = 404;
    throw err;
  }
  const row = result.rows[0];
  const briefing = await storedBriefingService.mergeAccountPrefs(
    JSON.parse(row.briefing_json),
    userId,
  );
  return {
    id: row.id,
    status: row.status,
    briefing,
    generated_at: row.generated_at,
    generation_time_ms: row.generation_time_ms,
  };
}

export async function deleteBriefing(userId, id) {
  const result = await db.execute({
    sql: "DELETE FROM ea_briefings WHERE id = ? AND user_id = ?",
    args: [id, userId],
  });
  if (!result.rowsAffected) {
    const err = new Error("Briefing not found");
    err.status = 404;
    throw err;
  }
}
