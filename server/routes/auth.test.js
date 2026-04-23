import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const mockDb = { execute: vi.fn() };

vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual("../middleware/auth.js");
  return {
    ...actual,
    requireCookieSession: (_req, _res, next) => next(),
  };
});

const authRoutes = (await import("./auth.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  return app;
}

describe("auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mints API tokens with a default expiry", async () => {
    const before = Date.now();
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });

    const res = await request(makeApp())
      .post("/api/auth/api-tokens")
      .send({ label: "Phone", scopes: ["actual:write"] });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eatk_/);
    expect(res.body.expires_at).toBeGreaterThan(before + 80 * 24 * 60 * 60 * 1000);
    expect(res.body.expires_at).toBeLessThan(before + 100 * 24 * 60 * 60 * 1000);
    expect(mockDb.execute).toHaveBeenCalledWith({
      sql: "INSERT INTO ea_api_tokens (token_hash, label, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      args: [
        expect.any(String),
        "Phone",
        JSON.stringify(["actual:write"]),
        expect.any(Number),
        res.body.expires_at,
      ],
    });
  });
});
