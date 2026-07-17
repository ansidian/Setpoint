import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthTestDb, seedSession } from "../test-utils/auth-db.ts";
import { createSessionRotation } from "./session-rotation.js";

describe("session rotation helper", () => {
  let db = null;

  beforeEach(async () => {
    db = await createAuthTestDb();
  });

  afterEach(async () => {
    await db?.close?.();
    db = null;
  });

  it("revokes all sessions before issuing the current browser replacement token", async () => {
    await seedSession(db, "old-session-1");
    await seedSession(db, "old-session-2");
    const createSession = vi.fn(async () => {
      const rows = await db.execute("SELECT token FROM ea_sessions");
      expect(rows.rows).toHaveLength(0);
      await seedSession(db, "fresh-session");
      return "fresh-session";
    });
    const rotation = createSessionRotation(db, createSession);

    await expect(rotation.rotateSessionsForCurrentBrowser()).resolves.toBe("fresh-session");
    expect(createSession).toHaveBeenCalledTimes(1);

    const rows = await db.execute("SELECT token FROM ea_sessions");
    expect(rows.rows).toHaveLength(1);
  });
});
