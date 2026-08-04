import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("../middleware/auth.ts", () => ({
  requireCookieSession: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.cookies?.ea_session === "valid" ? next() : res.status(401).json({ message: "Not authenticated" }),
}));

const { createOnboardingRouter } = await import("./onboarding.ts");

function app() {
  const progress = { version: 1, status: "in_progress", steps: {}, completedAt: null, updatedAt: 0 } as const;
  const store = { get: vi.fn(async () => progress), update: vi.fn(async () => progress) };
  const instance = express();
  instance.use(express.json());
  instance.use(cookieParser());
  instance.use("/api/onboarding", createOnboardingRouter(store, () => "owner-1"));
  return { instance, store };
}

describe("onboarding route", () => {
  it("requires authentication", async () => {
    expect((await request(app().instance).get("/api/onboarding")).status).toBe(401);
  });

  it("returns persisted owner progress", async () => {
    const { instance, store } = app();
    const response = await request(instance).get("/api/onboarding").set("Cookie", "ea_session=valid");
    expect(response.status).toBe(200);
    expect(store.get).toHaveBeenCalledWith("owner-1");
  });

  it("accepts only allowlisted progress mutations", async () => {
    const { instance, store } = app();
    const valid = await request(instance).patch("/api/onboarding")
      .set("Cookie", "ea_session=valid")
      .send({ action: "skip", stepId: "weather" });
    expect(valid.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith("owner-1", { action: "skip", stepId: "weather" });

    const invalid = await request(instance).patch("/api/onboarding")
      .set("Cookie", "ea_session=valid")
      .send({ action: "skip", stepId: "root_key" });
    expect(invalid.status).toBe(400);
    expect(store.update).toHaveBeenCalledTimes(1);
  });
});
