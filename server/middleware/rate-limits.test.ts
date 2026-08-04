import { describe, expect, it } from "vitest";
import express from "express";
import request from "../test-utils/supertest.ts";
import type { RequestHandler } from "express";
import type { Response as SuperTestResponse } from "../test-utils/supertest.ts";
import {
  makeBillExtractLimiter,
  makeAlfredRunLimiter,
  makeEmailSearchLimiter,
  makePlacesLimiter,
  makeActualConnectionLimiter,
} from "./rate-limits.ts";

function buildApp(limiter: RequestHandler) {
  const app = express();
  app.use(limiter);
  app.get("/probe", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

async function exhaustLimiter(limiter: RequestHandler, requestCount: number) {
  const client = request(buildApp(limiter));
  let lastRes: SuperTestResponse | undefined;
  for (let i = 0; i < requestCount; i += 1) {
    lastRes = await client.get("/probe");
  }
  return lastRes!;
}

describe("rate-limits", () => {
  it("billExtractLimiter allows up to max (20) requests then 429s with the JSON message and standard headers", async () => {
    const lastRes = await exhaustLimiter(makeBillExtractLimiter(), 21);

    expect(lastRes.status).toBe(429);
    expect(lastRes.body).toEqual({ message: "Too many bill-extract requests, try again later" });
    expect(lastRes.headers).toHaveProperty("ratelimit-limit");
  });

  it("alfredRunLimiter allows up to max (30) requests then 429s", async () => {
    const lastRes = await exhaustLimiter(makeAlfredRunLimiter(), 31);

    expect(lastRes.status).toBe(429);
    expect(lastRes.body).toEqual({ message: "Too many Alfred run requests, try again later" });
    expect(lastRes.headers).toHaveProperty("ratelimit-limit");
  });

  it("emailSearchLimiter allows up to max (120) requests then 429s", async () => {
    const lastRes = await exhaustLimiter(makeEmailSearchLimiter(), 121);

    expect(lastRes.status).toBe(429);
    expect(lastRes.body).toEqual({ message: "Too many email search requests, try again later" });
    expect(lastRes.headers).toHaveProperty("ratelimit-limit");
  });

  it("placesLimiter allows up to max (120) requests then 429s", async () => {
    const lastRes = await exhaustLimiter(makePlacesLimiter(), 121);

    expect(lastRes.status).toBe(429);
    expect(lastRes.body).toEqual({ message: "Too many places requests, try again later" });
    expect(lastRes.headers).toHaveProperty("ratelimit-limit");
  });

  it("actualConnectionLimiter bounds privileged connection probes", async () => {
    const lastRes = await exhaustLimiter(makeActualConnectionLimiter(), 11);

    expect(lastRes.status).toBe(429);
    expect(lastRes.body).toEqual({ message: "Too many Actual connection requests, try again later" });
    expect(lastRes.headers).toHaveProperty("ratelimit-limit");
  });
});
