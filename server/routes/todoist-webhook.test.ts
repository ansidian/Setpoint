import { afterAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import express from "express";
import request from "../test-utils/supertest.ts";
import { createTodoistWebhookRouter } from "./todoist-webhook.ts";

const ORIGINAL_ENV = {
  EA_USER_ID: process.env.EA_USER_ID,
  TODOIST_CLIENT_SECRET: process.env.TODOIST_CLIENT_SECRET,
};
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

process.env.EA_USER_ID = "user-1";
process.env.TODOIST_CLIENT_SECRET = "client-secret";

function signPayload(rawBody: Buffer, secret = "client-secret"): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
}

function makeApp(handleDelivery: Parameters<typeof createTodoistWebhookRouter>[0]) {
  const app = express();
  app.use(
    "/api/todoist/webhook",
    express.raw({ type: "*/*" }),
    createTodoistWebhookRouter(handleDelivery),
  );
  return app;
}

describe("Todoist webhook route", () => {
  beforeEach(() => {
    process.env.EA_USER_ID = "user-1";
    process.env.TODOIST_CLIENT_SECRET = "client-secret";
  });

  afterAll(() => {
    restoreEnv("EA_USER_ID", ORIGINAL_ENV.EA_USER_ID);
    restoreEnv("TODOIST_CLIENT_SECRET", ORIGINAL_ENV.TODOIST_CLIENT_SECRET);
  });

  it("preserves the exact raw request body and delivery headers", async () => {
    const rawBody = Buffer.from(JSON.stringify({
      event_name: "item:updated",
      event_data: { content: "Café planning" },
    }));
    const handleDelivery: Parameters<typeof createTodoistWebhookRouter>[0] = async (delivery = {}) => {
      const exact = delivery.userId === "user-1"
        && Buffer.isBuffer(delivery.rawBody)
        && delivery.rawBody.equals(rawBody)
        && delivery.headers?.["x-todoist-delivery-id"] === "delivery-1";
      if (!exact) throw Object.assign(new Error("Raw webhook transport changed"), { status: 400 });
      return { accepted: true, duplicate: false };
    };

    const res = await request(makeApp(handleDelivery))
      .post("/api/todoist/webhook")
      .set("Content-Type", "application/json")
      .set("X-Todoist-Hmac-SHA256", signPayload(rawBody))
      .set("X-Todoist-Delivery-ID", "delivery-1")
      .send(rawBody.toString("utf8"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, duplicate: false });
  });

  it("maps invalid signatures to 401 responses", async () => {
    const res = await request(makeApp(async () => {
      throw Object.assign(new Error("Invalid Todoist webhook signature"), { status: 401 });
    }))
      .post("/api/todoist/webhook")
      .set("X-Todoist-Hmac-SHA256", "bad")
      .set("X-Todoist-Delivery-ID", "delivery-1")
      .send("{}");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("maps production missing-secret failures to 503 responses", async () => {
    const res = await request(makeApp(async () => {
      throw Object.assign(new Error("Todoist webhook client secret is not configured"), { status: 503 });
    }))
      .post("/api/todoist/webhook")
      .set("X-Todoist-Hmac-SHA256", "bad")
      .set("X-Todoist-Delivery-ID", "delivery-1")
      .send("{}");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ message: "Todoist webhook not configured" });
  });
});
