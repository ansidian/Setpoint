// server/routes/news.test.js
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createMigratedDb } from "../snapshots/snapshot-test-fixtures.js";

const testState = vi.hoisted(() => ({ db: { current: null } }));

vi.mock("../middleware/auth.js", () => ({
  requireCookieSession: (_req, _res, next) => next(),
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
    executeMultiple: (...args) => testState.db.current.executeMultiple(...args),
    batch: (...args) => testState.db.current.batch(...args),
  },
}));

vi.mock("../news/news-preview.js", () => ({
  previewNewsFeed: vi.fn(async (url) => (url.includes("nofeed")
    ? null
    : { feedUrl: `${url.replace(/\/$/, "")}/feed`, title: "Resolved Feed", sampleTitles: ["A", "B"] })),
}));

vi.mock("../news/news-poller.js", async (importOriginal) => ({
  ...(await importOriginal()),
  requestImmediateNewsSweep: vi.fn(async () => ({ swept: 3, throttled: false })),
}));

process.env.EA_USER_ID = "u1";
const { default: router } = await import("./news.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/news", router);
  return app;
}

describe("news routes", () => {
  let app;
  beforeEach(async () => {
    testState.db.current = await createMigratedDb();
    app = makeApp();
  });

  it("GET / returns an empty shaped payload for a fresh user", async () => {
    const res = await request(app).get("/api/news");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lastSeenAt: null, topics: [] });
  });

  it("POST /topics creates a topic at the end position", async () => {
    await request(app).post("/api/news/topics").send({ name: "AI" });
    const res = await request(app).post("/api/news/topics").send({ name: "Tech" });
    expect(res.status).toBe(200);
    const page = await request(app).get("/api/news");
    expect(page.body.topics.map((t) => t.name)).toEqual(["AI", "Tech"]);
  });

  it("rejects a blank topic name", async () => {
    const res = await request(app).post("/api/news/topics").send({ name: "  " });
    expect(res.status).toBe(400);
  });

  it("POST /topics/import-starter copies chosen catalog bundles", async () => {
    const res = await request(app).post("/api/news/topics/import-starter")
      .send({ names: ["AI", "PC Hardware"] });
    expect(res.status).toBe(200);
    const page = await request(app).get("/api/news");
    expect(page.body.topics.map((t) => t.name)).toEqual(["AI", "PC Hardware"]);
    const ai = page.body.topics.find((t) => t.name === "AI");
    expect(ai.sources.some((s) => s.kind === "hn" && s.hnQuery === "AI")).toBe(true);
  });

  it("POST /topics/reorder rewrites positions", async () => {
    await request(app).post("/api/news/topics").send({ name: "A" });
    await request(app).post("/api/news/topics").send({ name: "B" });
    const page1 = await request(app).get("/api/news");
    const ids = page1.body.topics.map((t) => t.id).reverse();
    await request(app).post("/api/news/topics/reorder").send({ ids });
    const page2 = await request(app).get("/api/news");
    expect(page2.body.topics.map((t) => t.name)).toEqual(["B", "A"]);
  });

  it("DELETE /topics/:id removes the topic, its sources, and their items", async () => {
    await request(app).post("/api/news/topics/import-starter").send({ names: ["AI"] });
    const page = await request(app).get("/api/news");
    const topicId = page.body.topics[0].id;
    const sourceId = page.body.topics[0].sources[0].id;
    await testState.db.current.execute({
      sql: `INSERT INTO ea_news_items (source_id, guid, url, canonical_url, title, fetched_at)
            VALUES (?, 'g', 'https://x', 'https://x', 't', datetime('now'))`,
      args: [sourceId],
    });
    const res = await request(app).delete(`/api/news/topics/${topicId}`);
    expect(res.status).toBe(200);
    for (const table of ["ea_news_topics", "ea_news_sources", "ea_news_items"]) {
      const count = (await testState.db.current.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n;
      expect(Number(count)).toBe(0);
    }
  });

  it("PATCH /topics/:id accepts mutedTerms and GET reflects them", async () => {
    await request(app).post("/api/news/topics").send({ name: "AI" });
    const page = await request(app).get("/api/news");
    const topicId = page.body.topics[0].id;
    const res = await request(app).patch(`/api/news/topics/${topicId}`)
      .send({ mutedTerms: [" crypto ", "Crypto", "sponsored"] });
    expect(res.status).toBe(200);
    const after = await request(app).get("/api/news");
    expect(after.body.topics[0].mutedTerms).toEqual(["crypto", "sponsored"]);
  });

  it("PATCH /topics/:id still renames, rejects invalid mutedTerms and empty updates", async () => {
    await request(app).post("/api/news/topics").send({ name: "AI" });
    const page = await request(app).get("/api/news");
    const topicId = page.body.topics[0].id;
    const rename = await request(app).patch(`/api/news/topics/${topicId}`).send({ name: "ML" });
    expect(rename.status).toBe(200);
    expect((await request(app).get("/api/news")).body.topics[0].name).toBe("ML");
    expect((await request(app).patch(`/api/news/topics/${topicId}`).send({ mutedTerms: "crypto" })).status).toBe(400);
    expect((await request(app).patch(`/api/news/topics/${topicId}`).send({ mutedTerms: [42] })).status).toBe(400);
    expect((await request(app).patch(`/api/news/topics/${topicId}`).send({ name: "  " })).status).toBe(400);
    expect((await request(app).patch(`/api/news/topics/${topicId}`).send({})).status).toBe(400);
  });

  it("POST /sources/preview resolves a feed; 422 when nothing found", async () => {
    const good = await request(app).post("/api/news/sources/preview").send({ url: "https://site.test" });
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ feedUrl: "https://site.test/feed", title: "Resolved Feed" });
    const bad = await request(app).post("/api/news/sources/preview").send({ url: "https://nofeed.test" });
    expect(bad.status).toBe(422);
  });

  it("POST /sources creates rss and hn sources; PATCH toggles; DELETE removes with items", async () => {
    await request(app).post("/api/news/topics").send({ name: "AI" });
    const page = await request(app).get("/api/news");
    const topicId = page.body.topics[0].id;

    const rss = await request(app).post("/api/news/sources")
      .send({ topicId, kind: "rss", title: "Feed", feedUrl: "https://site.test/feed", siteUrl: "https://site.test" });
    expect(rss.status).toBe(200);

    const hn = await request(app).post("/api/news/sources")
      .send({ topicId, kind: "hn", title: "HN AI", hnQuery: "AI", minPoints: 60 });
    expect(hn.status).toBe(200);
    expect(hn.body.source.feedUrl).toBe("https://hnrss.org/newest?q=AI&points=60");

    const patch = await request(app).patch(`/api/news/sources/${rss.body.source.id}`).send({ enabled: false });
    expect(patch.status).toBe(200);
    const after = await request(app).get("/api/news");
    expect(after.body.topics[0].sources.find((s) => s.id === rss.body.source.id).enabled).toBe(false);

    const del = await request(app).delete(`/api/news/sources/${rss.body.source.id}`);
    expect(del.status).toBe(200);
  });

  it("POST /seen persists and GET / reflects it", async () => {
    const res = await request(app).post("/api/news/seen").send({ at: "2026-07-04T12:00:00.000Z" });
    expect(res.status).toBe(200);
    const page = await request(app).get("/api/news");
    expect(page.body.lastSeenAt).toBe("2026-07-04T12:00:00.000Z");
  });

  it("POST /refresh triggers the sweep", async () => {
    const res = await request(app).post("/api/news/refresh");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ swept: 3 });
  });

  it("GET /catalog returns the starter catalog", async () => {
    const res = await request(app).get("/api/news/catalog");
    expect(res.status).toBe(200);
    expect(res.body.topics.map((t) => t.name)).toContain("3D Printing");
  });
});
