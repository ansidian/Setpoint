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

vi.mock("../email/gmail-sync.js", () => ({
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

  it("accepts a correct token through the constant-time compare", async () => {
    const body = { message: { data: "abc", messageId: "pubsub-ct-ok" } };

    const res = await request(makeApp())
      .post("/api/gmail/push?token=push-secret")
      .send(body);

    expect(res.status).toBe(200);
    expect(gmailSyncApi.enqueueHistorySyncFromPubSub).toHaveBeenCalledWith(body);
  });

  it("rejects a same-length wrong token (constant-time path does not throw on equal lengths)", async () => {
    // "push-wrong!" is the same length as "push-secret" — guards against a
    // raw timingSafeEqual that would otherwise have thrown on length mismatch
    // and against an early-out length check leaking that the lengths matched.
    expect("push-wrong!".length).toBe("push-secret".length);

    const res = await request(makeApp())
      .post("/api/gmail/push?token=push-wrong!")
      .send({ message: { data: "abc", messageId: "pubsub-ct-bad" } });

    expect(res.status).toBe(401);
    expect(gmailSyncApi.enqueueHistorySyncFromPubSub).not.toHaveBeenCalled();
  });

  it("rejects a different-length wrong token without throwing (hash-first equalizes lengths)", async () => {
    const res = await request(makeApp())
      .post("/api/gmail/push?token=x")
      .send({ message: { data: "abc", messageId: "pubsub-ct-len" } });

    expect(res.status).toBe(401);
    expect(gmailSyncApi.enqueueHistorySyncFromPubSub).not.toHaveBeenCalled();
  });
});
