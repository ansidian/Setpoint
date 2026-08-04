import express from "express";
import { expect, it } from "vitest";
import request from "./supertest.ts";

it("routes sustained requests without exhausting ephemeral ports", async () => {
  // Direct request(app) usage failed around 8,000 calls on macOS because every
  // call allocated a listener and client socket. Stay above that regression
  // threshold while also proving that distinct apps cannot be cross-routed.
  for (let index = 0; index < 10_000; index += 1) {
    const marker = `marker-${index}`;
    const app = express();
    app.get("/probe", (_req, res) => res.json({ marker }));
    const response = await request(app).get("/probe");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ marker });
  }
}, 30_000);
