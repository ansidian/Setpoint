import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createAuthTestDb, hashApiToken, seedSession } from "../test-utils/auth-db.js";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));

const authRoutes = (await import("./auth.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  return app;
}

describe("auth routes", () => {
  beforeEach(async () => {
    testState.db.current = await createAuthTestDb();
    await seedSession(testState.db.current, "cookie-session");
  });

  afterEach(async () => {
    await testState.db.current?.close?.();
    testState.db.current = null;
  });

  it("mints API tokens with a default expiry", async () => {
    const before = Date.now();

    const res = await request(makeApp())
      .post("/api/auth/api-tokens")
      .set("Cookie", ["ea_session=cookie-session"])
      .send({ label: "Phone", scopes: ["actual:write"] });

    const result = await testState.db.current.execute({
      sql: "SELECT token_hash, label, scopes, created_at, expires_at FROM ea_api_tokens",
      args: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eatk_/);
    expect(res.body.expires_at).toBeGreaterThan(before + 80 * 24 * 60 * 60 * 1000);
    expect(res.body.expires_at).toBeLessThan(before + 100 * 24 * 60 * 60 * 1000);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      token_hash: hashApiToken(res.body.token),
      label: "Phone",
      scopes: JSON.stringify(["actual:write"]),
      expires_at: res.body.expires_at,
    });
    expect(result.rows[0].token_hash).not.toBe(res.body.token);
    expect(result.rows[0].created_at).toBeGreaterThanOrEqual(before);
  });
});
