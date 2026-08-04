import cookieParser from "cookie-parser";
import express from "express";
import request from "../test-utils/supertest.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createAuthTestDb, seedOwner, seedSession } from "../test-utils/auth-db.ts";
import { createRequireCookieSession } from "../middleware/auth.ts";
import { createCapabilitiesRouter } from "./capabilities.ts";

let authDb: Client;

function app() {
  const service = { getStatus: async ({ refresh }: { refresh?: boolean } = {}) => ({
    generatedAt: refresh ? "refreshed" : "cached",
    capabilities: [],
  }) };
  const instance = express();
  instance.use(cookieParser());
  instance.use("/api/capabilities", createCapabilitiesRouter(service, createRequireCookieSession(authDb)));
  return { instance, service };
}

describe("capability status route", () => {
  beforeEach(async () => {
    authDb = await createAuthTestDb();
    await seedOwner(authDb, { passwordHash: "hash" });
    await seedSession(authDb, "valid");
  });

  afterEach(() => authDb.close());

  it("requires authentication", async () => {
    expect((await request(app().instance).get("/api/capabilities")).status).toBe(401);
  });

  it("returns the shared projection and accepts only an explicit refresh flag", async () => {
    const { instance } = app();
    const response = await request(instance).get("/api/capabilities?refresh=1").set("Cookie", "ea_session=valid");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ generatedAt: "refreshed", capabilities: [] });
  });
});
