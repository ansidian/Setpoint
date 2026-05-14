import db from "../db/connection.js";
import { createSession } from "../middleware/auth.js";

export function createSessionRotation(database = db, createSessionToken = createSession) {
  async function revokeAllSessions() {
    await database.execute("DELETE FROM ea_sessions");
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
