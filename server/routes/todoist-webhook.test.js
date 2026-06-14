import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import express from "express";
import request from "supertest";

const webhookApi = vi.hoisted(() => ({
  handleTodoistWebhookDelivery: vi.fn(async () => ({ accepted: true, duplicate: false })),
}));

vi.mock("../tasks/todoist-webhook.js", () => ({
  handleTodoistWebhookDelivery: webhookApi.handleTodoistWebhookDelivery,
}));

process.env.EA_USER_ID = "user-1";
process.env.TODOIST_CLIENT_SECRET = "client-secret";

const todoistWebhookRoutes = (await import("./todoist-webhook.js")).default;

function signPayload(rawBody, secret = "client-secret") {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
}

function makeApp() {
  const app = express();
  app.use("/api/todoist/webhook", express.raw({ type: "*/*" }), todoistWebhookRoutes);
  return app;
}

describe("Todoist webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the exact raw request body to webhook handling", async () => {
    const rawBody = Buffer.from(JSON.stringify({
      event_name: "item:updated",
      event_data: { content: "Café planning" },
    }));

    const res = await request(makeApp())
      .post("/api/todoist/webhook")
      .set("Content-Type", "application/json")
      .set("X-Todoist-Hmac-SHA256", signPayload(rawBody))
      .set("X-Todoist-Delivery-ID", "delivery-1")
      .send(rawBody.toString("utf8"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, duplicate: false });
    expect(webhookApi.handleTodoistWebhookDelivery).toHaveBeenCalledWith({
      userId: "user-1",
      rawBody,
      headers: expect.objectContaining({
        "x-todoist-delivery-id": "delivery-1",
      }),
    });
  });

  it("maps invalid signatures to 401 responses", async () => {
    webhookApi.handleTodoistWebhookDelivery.mockRejectedValueOnce(
      Object.assign(new Error("Invalid Todoist webhook signature"), { status: 401 }),
    );

    const res = await request(makeApp())
      .post("/api/todoist/webhook")
      .set("X-Todoist-Hmac-SHA256", "bad")
      .set("X-Todoist-Delivery-ID", "delivery-1")
      .send("{}");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("maps production missing-secret failures to 503 responses", async () => {
    webhookApi.handleTodoistWebhookDelivery.mockRejectedValueOnce(
      Object.assign(new Error("Todoist webhook client secret is not configured"), { status: 503 }),
    );

    const res = await request(makeApp())
      .post("/api/todoist/webhook")
      .set("X-Todoist-Hmac-SHA256", "bad")
      .set("X-Todoist-Delivery-ID", "delivery-1")
      .send("{}");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ message: "Todoist webhook not configured" });
  });
});
