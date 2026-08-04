import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("../middleware/auth.ts", () => ({
  requireCookieSession: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.cookies?.ea_session === "valid" ? next() : res.status(401).json({ message: "Not authenticated" }),
}));

const { createCapabilitiesRouter } = await import("./capabilities.ts");

function app() {
  const service = { getStatus: vi.fn(async () => ({ generatedAt: "2026-07-18T00:00:00.000Z", capabilities: [] })) };
  const instance = express();
  instance.use(cookieParser());
  instance.use("/api/capabilities", createCapabilitiesRouter(service));
  return { instance, service };
}

describe("capability status route", () => {
  it("requires authentication", async () => {
    expect((await request(app().instance).get("/api/capabilities")).status).toBe(401);
  });

  it("returns the shared projection and accepts only an explicit refresh flag", async () => {
    const { instance, service } = app();
    const response = await request(instance).get("/api/capabilities?refresh=1").set("Cookie", "ea_session=valid");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ generatedAt: "2026-07-18T00:00:00.000Z", capabilities: [] });
    expect(service.getStatus).toHaveBeenCalledWith({ refresh: true });
  });
});
