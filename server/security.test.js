import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  applySecurityMiddleware,
  buildContentSecurityPolicy,
  getTrustProxySetting,
} from "./security.js";

describe("security config", () => {
  it("defaults trust proxy off in dev and one proxy in production", () => {
    expect(getTrustProxySetting({ NODE_ENV: "development" })).toBe(false);
    expect(getTrustProxySetting({ NODE_ENV: "production" })).toBe(1);
    expect(getTrustProxySetting({ NODE_ENV: "production", TRUST_PROXY: "true" })).toBe(true);
    expect(getTrustProxySetting({ NODE_ENV: "production", TRUST_PROXY: "loopback" })).toBe("loopback");
  });

  it("applies baseline security headers and production CSP/HSTS", async () => {
    const app = express();
    applySecurityMiddleware(app, { NODE_ENV: "production" });
    app.get("/ping", (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/ping");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["permissions-policy"]).toContain("camera=()");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["content-security-policy"]).toBe(buildContentSecurityPolicy());
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });
});
