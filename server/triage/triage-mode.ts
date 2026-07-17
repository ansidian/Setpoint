import db from "../db/connection.ts";
import type { EffectiveEmailTriageMode, StoredEmailTriageMode } from "../../shared/types/settings.ts";
import type { TriageDb, TriageModeResult } from "./triage-types.ts";

export const STORED_EMAIL_TRIAGE_MODES = ["auto", "real", "no_model", "paused"] as const;
const STORED_EMAIL_TRIAGE_MODE_SET = new Set<StoredEmailTriageMode>(STORED_EMAIL_TRIAGE_MODES);

export function isAllowedStoredEmailTriageMode(value: unknown): value is StoredEmailTriageMode {
  return typeof value === "string" && STORED_EMAIL_TRIAGE_MODE_SET.has(value as StoredEmailTriageMode);
}

export function normalizeStoredEmailTriageMode(value: unknown): StoredEmailTriageMode {
  return isAllowedStoredEmailTriageMode(value) ? value : "auto";
}

export function resolveEffectiveEmailTriageMode(value: unknown, {
  nodeEnv = process.env.NODE_ENV,
}: { nodeEnv?: string } = {}): EffectiveEmailTriageMode {
  const storedMode = normalizeStoredEmailTriageMode(value);
  if (storedMode !== "auto") return storedMode;
  return nodeEnv === "production" ? "real" : "no_model";
}

export async function getEmailTriageModeForUser(userId: string, {
  dbClient = db as unknown as TriageDb,
  nodeEnv = process.env.NODE_ENV,
}: { dbClient?: TriageDb; nodeEnv?: string } = {}): Promise<TriageModeResult> {
  let storedMode: StoredEmailTriageMode = "auto";
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
