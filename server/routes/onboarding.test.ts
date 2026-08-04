import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createAuthTestDb, seedOwner, seedSession } from "../test-utils/auth-db.ts";
import { createRequireCookieSession } from "../middleware/auth.ts";
import { createOnboardingRouter } from "./onboarding.ts";

let authDb: Client;

function app() {
  const progress = { version: 1, status: "in_progress", steps: {}, completedAt: null, updatedAt: 0 } as const;
  const store = {
    get: async (ownerId: string) => ({ ...progress, updatedAt: ownerId === "owner-1" ? 1 : -1 }),
    update: async (ownerId: string, mutation: { action: string; stepId?: string }) => ({
      ...progress,
      steps: mutation.stepId ? { [mutation.stepId]: mutation.action } : {},
      updatedAt: ownerId === "owner-1" ? 2 : -1,
    }),
  };
  const instance = express();
  instance.use(express.json());
  instance.use(cookieParser());
  instance.use(
    "/api/onboarding",
    createOnboardingRouter(store, () => "owner-1", createRequireCookieSession(authDb)),
  );
  return { instance, store };
}

describe("onboarding route", () => {
  beforeEach(async () => {
    authDb = await createAuthTestDb();
    await seedOwner(authDb, { passwordHash: "hash" });
    await seedSession(authDb, "valid");
  });

  afterEach(() => authDb.close());

  it("requires authentication", async () => {
    expect((await request(app().instance).get("/api/onboarding")).status).toBe(401);
  });

  it("returns persisted owner progress", async () => {
    const { instance } = app();
    const response = await request(instance).get("/api/onboarding").set("Cookie", "ea_session=valid");
    expect(response.status).toBe(200);
    expect(response.body.updatedAt).toBe(1);
  });

  it("accepts only allowlisted progress mutations", async () => {
    const { instance } = app();
    const valid = await request(instance).patch("/api/onboarding")
      .set("Cookie", "ea_session=valid")
      .send({ action: "skip", stepId: "weather" });
    expect(valid.status).toBe(200);
    expect(valid.body).toMatchObject({ steps: { weather: "skip" }, updatedAt: 2 });

    const invalid = await request(instance).patch("/api/onboarding")
      .set("Cookie", "ea_session=valid")
      .send({ action: "skip", stepId: "root_key" });
    expect(invalid.status).toBe(400);
  });
});
