import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import zlib from "zlib";
import { responseCompression } from "./compression.ts";

const BIG = "x".repeat(5000);

function makeApp(options: { threshold?: number } = {}) {
  const app = express();
  app.use(responseCompression(options));
  return app;
}

describe("responseCompression", () => {
  it("gzip-compresses a large JSON body when the client accepts gzip", async () => {
    const app = makeApp();
    app.get("/big", (req, res) => res.json({ data: BIG }));
    const res = await request(app).get("/big").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers["vary"]).toMatch(/Accept-Encoding/i);
    // supertest transparently gunzips; the payload must survive the round trip.
    expect(res.body.data).toBe(BIG);
  });

  it("leaves the body uncompressed when the client does not accept gzip", async () => {
    const app = makeApp();
    app.get("/big", (req, res) => res.json({ data: BIG }));
    const res = await request(app).get("/big").set("Accept-Encoding", "identity");
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.data).toBe(BIG);
  });

  it("skips bodies below the size threshold", async () => {
    const app = makeApp();
    app.get("/small", (req, res) => res.json({ ok: true }));
    const res = await request(app).get("/small").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.ok).toBe(true);
  });

  it("never compresses server-sent event streams (would break streaming)", async () => {
    const app = makeApp();
    app.get("/sse", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(`data: ${BIG}\n\n`);
      res.end();
    });
    const res = await request(app).get("/sse").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.text).toContain(BIG);
  });

  it("does not re-compress a response that is already gzip-encoded", async () => {
    const app = makeApp();
    app.get("/pre", (req, res) => {
      const gz = zlib.gzipSync(Buffer.from(BIG));
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(gz.length));
      res.end(gz);
    });
    const res = await request(app).get("/pre").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBe("gzip");
    // supertest gunzips exactly once; equality with BIG proves we did NOT re-gzip.
    expect(res.text).toBe(BIG);
  });

  it("does not compress binary asset types like png", async () => {
    const app = makeApp();
    app.get("/img", (req, res) => {
      res.setHeader("Content-Type", "image/png");
      res.end(Buffer.alloc(5000, 1));
    });
    const res = await request(app).get("/img").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBeUndefined();
  });
});
