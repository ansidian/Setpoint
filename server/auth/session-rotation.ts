import db from "../db/connection.ts";
import { createSession, __clearSessionValidationCache } from "../middleware/auth.ts";
import type { Client } from "@libsql/client";

export function createSessionRotation(
  database: Client = db,
  createSessionToken: () => Promise<string> = createSession,
) {
  async function revokeAllSessions() {
    await database.execute("DELETE FROM ea_sessions");
    // P2-27: this wipes every session row, so drop the whole validation cache to
    // avoid a stale positive surviving a passkey-driven revocation.
    __clearSessionValidationCache();
  }

  async function rotateSessionsForCurrentBrowser() {
    await revokeAllSessions();
    return createSessionToken();
  }

  return {
    revokeAllSessions,
    rotateSessionsForCurrentBrowser,
  };
}

const sessionRotation = createSessionRotation();

export const revokeAllSessions = sessionRotation.revokeAllSessions;
export const rotateSessionsForCurrentBrowser = sessionRotation.rotateSessionsForCurrentBrowser;
