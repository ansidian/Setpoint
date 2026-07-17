import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { activateOwner, __resetOwnerContextForTests } from "../auth/owner-context.ts";
import { requireClaimedInstance } from "./owner-gate.ts";

function makeApp() {
  const app = express();
  app.use("/api", requireClaimedInstance);
  app.get("/api/auth/setup/status", (_req, res) => res.json({ claimed: false }));
  app.get("/api/provider", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("claimed-instance API gate", () => {
  afterEach(() => __resetOwnerContextForTests());

  it("keeps public setup status reachable before claim", async () => {
    const res = await request(makeApp()).get("/api/auth/setup/status");

    expect(res.status).toBe(200);
  });

  it("blocks provider APIs before claim with a fixed response", async () => {
    const res = await request(makeApp()).get("/api/provider");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ message: "Instance setup required" });
  });

  it("allows provider APIs after claim", async () => {
    activateOwner({
      singletonId: 1,
      userId: "owner-1",
      passwordHash: "not-exposed",
      claimedAt: 1,
    });

    const res = await request(makeApp()).get("/api/provider");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
