import type { Client } from "@libsql/client";
import db from "../db/connection.ts";

export const PASSWORD_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_LOGIN_MAX_ATTEMPTS = 10;

export function createPasswordLoginThrottle(database: Pick<Client, "execute"> = db) {
  async function reserveAttempt(now = Date.now()): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    // Reserve before bcrypt, including successful attempts. One atomic write
    // bounds concurrent requests across IPs/processes; no success can erase
    // another request's reservation. Rejected requests never extend the window.
    const admitted = await database.execute({
      sql: `UPDATE ea_owner
               SET password_login_attempt_count = CASE
                     WHEN password_login_reset_at <= ? THEN 1
                     ELSE password_login_attempt_count + 1
                   END,
                   password_login_reset_at = CASE
                     WHEN password_login_reset_at <= ? THEN ?
                     ELSE password_login_reset_at
                   END
             WHERE singleton_id = 1
               AND (password_login_reset_at <= ? OR password_login_attempt_count < ?)
         RETURNING password_login_reset_at`,
      args: [now, now, now + PASSWORD_LOGIN_WINDOW_MS, now, PASSWORD_LOGIN_MAX_ATTEMPTS],
    });
    if (admitted.rows.length) return { allowed: true, retryAfterSeconds: 0 };

    const result = await database.execute({
      sql: "SELECT password_login_reset_at FROM ea_owner WHERE singleton_id = 1",
      args: [],
    });
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((Number(result.rows[0]?.password_login_reset_at || now) - now) / 1000)),
    };
  }

  return { reserveAttempt };
}

export const passwordLoginThrottle = createPasswordLoginThrottle();
