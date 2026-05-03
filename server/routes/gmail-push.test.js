import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const gmailSyncApi = vi.hoisted(() => ({
  enqueueHistorySyncFromPubSub: vi.fn(async () => ({
    queued: true,
    account_id: "gmail-work",
    history_id: "987",
  })),
}));

vi.mock("../briefing/gmail-sync.js", () => ({
  enqueueHistorySyncFromPubSub: gmailSyncApi.enqueueHistorySyncFromPubSub,
}));

process.env.GMAIL_PUBSUB_PUSH_TOKEN = "push-secret";

const gmailPushRoutes = (await import("./gmail-push.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/gmail", gmailPushRoutes);
  return app;
}

describe("Gmail Pub/Sub push route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acks a verified Pub/Sub push after queuing account history sync", async () => {
    const body = { message: { data: "abc", messageId: "pubsub-1" } };

    const res = await request(makeApp())
      .post("/api/gmail/push")
      .set("Authorization", "Bearer push-secret")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      queued: true,
      account_id: "gmail-work",
      history_id: "987",
    });
    expect(gmailSyncApi.enqueueHistorySyncFromPubSub).toHaveBeenCalledWith(body);
  });

  it("accepts the query token even when Pub/Sub OIDC auth sets its own bearer header", async () => {
    const body = { message: { data: "abc", messageId: "pubsub-oidc" } };

    const res = await request(makeApp())
      .post("/api/gmail/push?token=push-secret")
      .set("Authorization", "Bearer google-oidc-jwt")
      .send(body);

    expect(res.status).toBe(200);
    expect(gmailSyncApi.enqueueHistorySyncFromPubSub).toHaveBeenCalledWith(body);
  });

  it("rejects pushes without the configured token", async () => {
    const res = await request(makeApp())
      .post("/api/gmail/push")
      .set("Authorization", "Bearer wrong")
      .send({ message: { data: "abc" } });

    expect(res.status).toBe(401);
    expect(gmailSyncApi.enqueueHistorySyncFromPubSub).not.toHaveBeenCalled();
  });
});
