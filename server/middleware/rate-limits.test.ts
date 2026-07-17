import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { RequestHandler } from "express";
import type { Response as SuperTestResponse } from "supertest";
import {
  makeBillExtractLimiter,
  makeAlfredRunLimiter,
  makeEmailSearchLimiter,
  makePlacesLimiter,
} from "./rate-limits.ts";

function buildApp(limiter: RequestHandler) {
  const app = express();
  app.use(limiter);
  app.get("/probe", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("rate-limits", () => {
  it("billExtractLimiter allows up to max (20) requests then 429s with the JSON message and standard headers", async () => {
    const app = buildApp(makeBillExtractLimiter());

    let lastRes: SuperTestResponse | undefined;
    for (let i = 0; i < 21; i += 1) {
      lastRes = await request(app).get("/probe");
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body).toEqual({ message: "Too many bill-extract requests, try again later" });
    expect(lastRes!.headers).toHaveProperty("ratelimit-limit");
  });

  it("alfredRunLimiter allows up to max (30) requests then 429s", async () => {
    const app = buildApp(makeAlfredRunLimiter());

    let lastRes: SuperTestResponse | undefined;
    for (let i = 0; i < 31; i += 1) {
      lastRes = await request(app).get("/probe");
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body).toEqual({ message: "Too many Alfred run requests, try again later" });
    expect(lastRes!.headers).toHaveProperty("ratelimit-limit");
  });

  it("emailSearchLimiter allows up to max (120) requests then 429s", async () => {
    const app = buildApp(makeEmailSearchLimiter());

    let lastRes: SuperTestResponse | undefined;
    for (let i = 0; i < 121; i += 1) {
      lastRes = await request(app).get("/probe");
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body).toEqual({ message: "Too many email search requests, try again later" });
    expect(lastRes!.headers).toHaveProperty("ratelimit-limit");
  });

  it("placesLimiter allows up to max (120) requests then 429s", async () => {
    const app = buildApp(makePlacesLimiter());

    let lastRes: SuperTestResponse | undefined;
    for (let i = 0; i < 121; i += 1) {
      lastRes = await request(app).get("/probe");
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body).toEqual({ message: "Too many places requests, try again later" });
    expect(lastRes!.headers).toHaveProperty("ratelimit-limit");
  });
});
