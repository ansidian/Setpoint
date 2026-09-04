import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createAuthTestDb, seedOwner } from "../test-utils/auth-db.ts";
import {
  createPasswordLoginThrottle,
  PASSWORD_LOGIN_MAX_ATTEMPTS,
  PASSWORD_LOGIN_WINDOW_MS,
} from "./password-login-throttle.ts";

describe("owner password login budget", () => {
  let db: Client;
  beforeEach(async () => {
    db = await createAuthTestDb();
    await seedOwner(db, { passwordHash: "hash" });
  });
  afterEach(() => db.close());

  it("atomically caps concurrent attempts across independent store instances", async () => {
    const attempts = await Promise.all(Array.from({ length: 30 }, () => (
      createPasswordLoginThrottle(db).reserveAttempt(1_000)
    )));
    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(PASSWORD_LOGIN_MAX_ATTEMPTS);
    expect(attempts.filter((attempt) => !attempt.allowed)).toEqual(
      Array.from({ length: 30 - PASSWORD_LOGIN_MAX_ATTEMPTS }, () => ({
        allowed: false, retryAfterSeconds: 900,
      })),
    );
  });

  it("preserves the budget across recreation and security changes without extending blocked windows", async () => {
    const now = 1_000;
    const throttle = createPasswordLoginThrottle(db);
    for (let index = 0; index < PASSWORD_LOGIN_MAX_ATTEMPTS; index += 1) {
      await throttle.reserveAttempt(now);
    }
    await db.execute("UPDATE ea_owner SET security_generation = security_generation + 1");
    const restarted = createPasswordLoginThrottle(db);
    expect(await restarted.reserveAttempt(now + 1_000)).toEqual({ allowed: false, retryAfterSeconds: 899 });
    expect(await restarted.reserveAttempt(now + PASSWORD_LOGIN_WINDOW_MS - 1)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(await restarted.reserveAttempt(now + PASSWORD_LOGIN_WINDOW_MS)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect((await db.execute("SELECT password_login_attempt_count, password_login_reset_at FROM ea_owner")).rows)
      .toEqual([{ password_login_attempt_count: 1, password_login_reset_at: now + 2 * PASSWORD_LOGIN_WINDOW_MS }]);
  });

  it("fails closed when no owner exists", async () => {
    await db.execute("DELETE FROM ea_owner");
    expect((await createPasswordLoginThrottle(db).reserveAttempt()).allowed).toBe(false);
  });
});
