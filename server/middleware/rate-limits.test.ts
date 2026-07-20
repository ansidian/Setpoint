import { describe, expect, it } from "vitest";
import express from "express";
import { createServer } from "node:http";
import request from "supertest";
import type { RequestHandler } from "express";
import type { Response as SuperTestResponse } from "supertest";
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
  const server = createServer(buildApp(limiter));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  try {
    const client = request(server);
    let lastRes: SuperTestResponse | undefined;
    for (let i = 0; i < requestCount; i += 1) {
      lastRes = await client.get("/probe");
    }
    return lastRes!;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
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
