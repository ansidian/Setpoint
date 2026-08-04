import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createGmailPushRouter } from "./gmail-push.ts";

process.env.GMAIL_PUBSUB_PUSH_TOKEN = "push-secret";

function makeHarness({
  verifyToken = async (candidate: string) => candidate === "push-secret",
}: {
  verifyToken?: (candidate: string) => Promise<boolean>;
} = {}) {
  let drainRequests = 0;
  const app = express();
  app.use(express.json());
  app.use("/api/gmail", createGmailPushRouter({
    pubSubService: { verifyToken } as never,
    enqueue: async (body) => {
      const messageId = (body as { message?: { messageId?: string } } | null | undefined)?.message?.messageId;
      return {
        queued: true,
        account_id: `gmail-${messageId}`,
        history_id: "987",
      } as never;
    },
    requestDrain: () => { drainRequests += 1; },
  }));
  return { app, drainRequests: () => drainRequests };
}

describe("Gmail Pub/Sub push route", () => {
  it("acks a verified Pub/Sub push and requests an immediate background history drain", async () => {
    const body = { message: { data: "abc", messageId: "pubsub-1" } };
    const harness = makeHarness();

    const res = await request(harness.app)
      .post("/api/gmail/push")
      .set("Authorization", "Bearer push-secret")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      queued: true,
      account_id: "gmail-pubsub-1",
      history_id: "987",
    });
    expect(harness.drainRequests()).toBe(1);
  });

  it("accepts the query token even when Pub/Sub OIDC auth sets its own bearer header", async () => {
    const res = await request(makeHarness().app)
      .post("/api/gmail/push?token=push-secret")
      .set("Authorization", "Bearer google-oidc-jwt")
      .send({ message: { data: "abc", messageId: "pubsub-oidc" } });

    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe("gmail-pubsub-oidc");
  });

  it("rejects pushes without the configured token", async () => {
    const res = await request(makeHarness().app)
      .post("/api/gmail/push")
      .set("Authorization", "Bearer wrong")
      .send({ message: { data: "abc" } });

    expect(res.status).toBe(401);
  });

  it("accepts a correct query token", async () => {
    const res = await request(makeHarness().app)
      .post("/api/gmail/push?token=push-secret")
      .send({ message: { data: "abc", messageId: "pubsub-ok" } });

    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe("gmail-pubsub-ok");
  });

  it("rejects a same-length wrong token", async () => {
    expect("push-wrong!".length).toBe("push-secret".length);
    const res = await request(makeHarness().app)
      .post("/api/gmail/push?token=push-wrong!")
      .send({ message: { data: "abc" } });

    expect(res.status).toBe(401);
  });

  it("rejects a different-length wrong token without throwing", async () => {
    const res = await request(makeHarness().app)
      .post("/api/gmail/push?token=x")
      .send({ message: { data: "abc" } });

    expect(res.status).toBe(401);
  });

  it("fails closed when the verifier reports no configured token", async () => {
    const res = await request(makeHarness({ verifyToken: async () => false }).app)
      .post("/api/gmail/push")
      .send({ message: { data: "abc" } });

    expect(res.status).toBe(401);
  });

  it("delegates verification on every request so regenerated tokens take effect without restart", async () => {
    let verificationCount = 0;
    const harness = makeHarness({
      verifyToken: async () => {
        verificationCount += 1;
        return verificationCount === 2;
      },
    });

    expect((await request(harness.app).post("/api/gmail/push?token=rotated").send({ message: { data: "abc" } })).status).toBe(401);
    expect((await request(harness.app).post("/api/gmail/push?token=rotated").send({ message: { data: "abc" } })).status).toBe(200);
    expect(verificationCount).toBe(2);
  });

  it("fails closed with a retryable response when authoritative token verification is unavailable", async () => {
    const messages: string[] = [];
    const log = vi.spyOn(console, "error").mockImplementation((...args) => { messages.push(args.map(String).join(" ")); });
    try {
      const res = await request(makeHarness({
        verifyToken: async () => { throw new Error("shared database unavailable"); },
      }).app)
        .post("/api/gmail/push?token=do-not-log-this-token")
        .send({ message: { data: "abc" } });

      expect(res.status).toBe(503);
      expect(messages.join(" ")).not.toContain("do-not-log-this-token");
    } finally {
      log.mockRestore();
    }
  });
});
