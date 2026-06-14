import db from "../db/connection.js";

export const STORED_EMAIL_TRIAGE_MODES = ["auto", "real", "no_model", "paused"];
const STORED_EMAIL_TRIAGE_MODE_SET = new Set(STORED_EMAIL_TRIAGE_MODES);

export function isAllowedStoredEmailTriageMode(value) {
  return STORED_EMAIL_TRIAGE_MODE_SET.has(value);
}

export function normalizeStoredEmailTriageMode(value) {
  return isAllowedStoredEmailTriageMode(value) ? value : "auto";
}

export function resolveEffectiveEmailTriageMode(value, {
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const storedMode = normalizeStoredEmailTriageMode(value);
  if (storedMode !== "auto") return storedMode;
  return nodeEnv === "production" ? "real" : "no_model";
}

export async function getEmailTriageModeForUser(userId, {
  dbClient = db,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  let storedMode = "auto";
  try {
    const result = await dbClient.execute({
      sql: "SELECT email_triage_mode FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    storedMode = normalizeStoredEmailTriageMode(result.rows?.[0]?.email_triage_mode);
  } catch {
    storedMode = "auto";
  }
  return {
    email_triage_mode: storedMode,
    effective_email_triage_mode: resolveEffectiveEmailTriageMode(storedMode, { nodeEnv }),
  };
}
