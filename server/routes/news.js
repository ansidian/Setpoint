import { Router } from "express";
import db from "../db/connection.ts";
import { requireCookieSession } from "../middleware/auth.ts";
import { buildHnFeedUrl, buildNewsPagePayload, sanitizeMutedTerms } from "../news/news-model.js";
import { NEWS_STARTER_CATALOG } from "../news/news-catalog.js";
import { previewNewsFeed } from "../news/news-preview.js";
import { requestImmediateNewsSweep } from "../news/news-poller.js";

const router = Router();
router.use(requireCookieSession);

const userId = () => process.env.EA_USER_ID;

async function loadPageRows() {
  const topics = await db.execute({
    sql: "SELECT * FROM ea_news_topics WHERE user_id = ? ORDER BY position, id",
    args: [userId()],
  });
  const sources = await db.execute({
    sql: `SELECT s.* FROM ea_news_sources s
          JOIN ea_news_topics t ON t.id = s.topic_id
          WHERE t.user_id = ? ORDER BY s.id`,
    args: [userId()],
  });
  const items = await db.execute({
    sql: `SELECT i.* FROM ea_news_items i
          JOIN ea_news_sources s ON s.id = i.source_id
          JOIN ea_news_topics t ON t.id = s.topic_id
          WHERE t.user_id = ?`,
    args: [userId()],
  });
  const settings = await db.execute({
    sql: "SELECT news_last_seen_at FROM ea_settings WHERE user_id = ?",
    args: [userId()],
  });
  return {
    topics: topics.rows || [],
    sources: sources.rows || [],
    items: items.rows || [],
    lastSeenAt: settings.rows?.[0]?.news_last_seen_at ?? null,
  };
}

async function requireOwnedTopic(topicId, res) {
  const topic = await db.execute({
    sql: "SELECT id FROM ea_news_topics WHERE id = ? AND user_id = ?",
    args: [topicId, userId()],
  });
  if (!topic.rows.length) {
    res.status(404).json({ message: "Topic not found" });
    return false;
  }
  return true;
}

router.get("/", async (_req, res) => {
  try {
    res.json(buildNewsPagePayload(await loadPageRows()));
  } catch (err) {
    console.error("Error building news page:", err);
    res.status(500).json({ message: "Failed to load news" });
  }
});

router.get("/catalog", (_req, res) => {
  res.json({ topics: NEWS_STARTER_CATALOG });
});

router.post("/topics", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ message: "Topic name is required" });
  try {
    const max = await db.execute({
      sql: "SELECT COALESCE(MAX(position), -1) AS p FROM ea_news_topics WHERE user_id = ?",
      args: [userId()],
    });
    const insert = await db.execute({
      sql: "INSERT INTO ea_news_topics (user_id, name, position) VALUES (?, ?, ?)",
      args: [userId(), name, Number(max.rows[0].p) + 1],
    });
    res.json({ id: Number(insert.lastInsertRowid), name });
  } catch (err) {
    console.error("Error creating news topic:", err);
    res.status(500).json({ message: "Failed to create topic" });
  }
});

async function insertCatalogTopic(bundle, position) {
  const insert = await db.execute({
    sql: "INSERT INTO ea_news_topics (user_id, name, position) VALUES (?, ?, ?)",
    args: [userId(), bundle.name, position],
  });
  const topicId = Number(insert.lastInsertRowid);
  for (const source of bundle.sources) {
    const feedUrl = source.kind === "hn"
      ? buildHnFeedUrl({ query: source.hnQuery, minPoints: source.minPoints })
      : source.feedUrl;
    await db.execute({
      sql: `INSERT INTO ea_news_sources (topic_id, kind, title, feed_url, site_url, hn_query, min_points)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [topicId, source.kind, source.title, feedUrl, source.siteUrl ?? null,
        source.hnQuery ?? null, source.minPoints ?? null],
    });
  }
}

router.post("/topics/import-starter", async (req, res) => {
  const names = Array.isArray(req.body?.names) ? req.body.names : [];
  const bundles = names
    .map((name) => NEWS_STARTER_CATALOG.find((bundle) => bundle.name === name))
    .filter(Boolean);
  if (!bundles.length) return res.status(400).json({ message: "No catalog topics selected" });
  try {
    const max = await db.execute({
      sql: "SELECT COALESCE(MAX(position), -1) AS p FROM ea_news_topics WHERE user_id = ?",
      args: [userId()],
    });
    let position = Number(max.rows[0].p) + 1;
    for (const bundle of bundles) {
      await insertCatalogTopic(bundle, position);
      position += 1;
    }
    requestImmediateNewsSweep().catch(() => {});
    res.json({ imported: bundles.map((bundle) => bundle.name) });
  } catch (err) {
    console.error("Error importing starter topics:", err);
    res.status(500).json({ message: "Failed to import starter topics" });
  }
});

router.post("/topics/reorder", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ message: "ids required" });
  try {
    await db.batch(ids.map((id, index) => ({
      sql: "UPDATE ea_news_topics SET position = ? WHERE id = ? AND user_id = ?",
      args: [index, id, userId()],
    })));
    res.json({ ok: true });
  } catch (err) {
    console.error("Error reordering news topics:", err);
    res.status(500).json({ message: "Failed to reorder topics" });
  }
});

router.patch("/topics/:id", async (req, res) => {
  const body = req.body || {};
  const updates = [];
  const args = [];
  if ("name" in body) {
    const name = String(body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Topic name is required" });
    updates.push("name = ?");
    args.push(name);
  }
  if ("mutedTerms" in body) {
    const terms = sanitizeMutedTerms(body.mutedTerms);
    if (!terms) return res.status(400).json({ message: "mutedTerms must be an array of short strings" });
    updates.push("muted_terms = ?");
    args.push(JSON.stringify(terms));
  }
  if (!updates.length) return res.status(400).json({ message: "Nothing to update" });
  try {
    if (!(await requireOwnedTopic(req.params.id, res))) return;
    await db.execute({
      sql: `UPDATE ea_news_topics SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      args: [...args, req.params.id, userId()],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Error updating news topic:", err);
    res.status(500).json({ message: "Failed to update topic" });
  }
});

router.delete("/topics/:id", async (req, res) => {
  try {
    if (!(await requireOwnedTopic(req.params.id, res))) return;
    await db.batch([
      {
        sql: `DELETE FROM ea_news_items WHERE source_id IN
              (SELECT id FROM ea_news_sources WHERE topic_id = ?)`,
        args: [req.params.id],
      },
      { sql: "DELETE FROM ea_news_sources WHERE topic_id = ?", args: [req.params.id] },
      { sql: "DELETE FROM ea_news_topics WHERE id = ? AND user_id = ?", args: [req.params.id, userId()] },
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting news topic:", err);
    res.status(500).json({ message: "Failed to delete topic" });
  }
});

router.post("/sources/preview", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ message: "A full http(s) URL is required" });
  try {
    const preview = await previewNewsFeed(url);
    if (!preview) {
      return res.status(422).json({
        message: "Not a feed, and no feed advertised at that URL — try the site's /feed path or openrss.org.",
      });
    }
    res.json(preview);
  } catch (err) {
    console.error("Error previewing news source:", err);
    res.status(502).json({ message: "Could not reach that URL" });
  }
});

router.post("/sources", async (req, res) => {
  const { topicId, kind = "rss", title, feedUrl, siteUrl, hnQuery, minPoints } = req.body || {};
  if (!topicId || !String(title || "").trim()) {
    return res.status(400).json({ message: "topicId and title are required" });
  }
  if (kind === "rss" && !/^https?:\/\//i.test(String(feedUrl || ""))) {
    return res.status(400).json({ message: "feedUrl is required for rss sources" });
  }
  try {
    if (!(await requireOwnedTopic(topicId, res))) return;
    const resolvedFeedUrl = kind === "hn"
      ? buildHnFeedUrl({ query: hnQuery ?? "", minPoints: minPoints ?? 50 })
      : feedUrl;
    const insert = await db.execute({
      sql: `INSERT INTO ea_news_sources (topic_id, kind, title, feed_url, site_url, hn_query, min_points)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [topicId, kind, String(title).trim(), resolvedFeedUrl, siteUrl ?? null,
        kind === "hn" ? (hnQuery ?? "") : null, kind === "hn" ? (minPoints ?? 50) : null],
    });
    requestImmediateNewsSweep().catch(() => {});
    res.json({
      source: {
        id: Number(insert.lastInsertRowid), topicId, kind,
        title: String(title).trim(), feedUrl: resolvedFeedUrl,
      },
    });
  } catch (err) {
    console.error("Error creating news source:", err);
    res.status(500).json({ message: "Failed to add source" });
  }
});

router.patch("/sources/:id", async (req, res) => {
  const updates = [];
  const args = [];
  if (typeof req.body?.enabled === "boolean") {
    updates.push("enabled = ?");
    args.push(req.body.enabled ? 1 : 0);
  }
  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    updates.push("title = ?");
    args.push(req.body.title.trim());
  }
  if (Number.isFinite(req.body?.minPoints)) {
    updates.push("min_points = ?");
    args.push(Math.round(req.body.minPoints));
  }
  if (!updates.length) return res.status(400).json({ message: "Nothing to update" });
  try {
    const result = await db.execute({
      sql: `UPDATE ea_news_sources SET ${updates.join(", ")}
            WHERE id = ? AND topic_id IN (SELECT id FROM ea_news_topics WHERE user_id = ?)`,
      args: [...args, req.params.id, userId()],
    });
    if (!result.rowsAffected) return res.status(404).json({ message: "Source not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Error updating news source:", err);
    res.status(500).json({ message: "Failed to update source" });
  }
});

router.delete("/sources/:id", async (req, res) => {
  try {
    const owned = await db.execute({
      sql: `SELECT s.id FROM ea_news_sources s JOIN ea_news_topics t ON t.id = s.topic_id
            WHERE s.id = ? AND t.user_id = ?`,
      args: [req.params.id, userId()],
    });
    if (!owned.rows.length) return res.status(404).json({ message: "Source not found" });
    await db.batch([
      { sql: "DELETE FROM ea_news_items WHERE source_id = ?", args: [req.params.id] },
      { sql: "DELETE FROM ea_news_sources WHERE id = ?", args: [req.params.id] },
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting news source:", err);
    res.status(500).json({ message: "Failed to delete source" });
  }
});

router.post("/seen", async (req, res) => {
  const at = req.body?.at || new Date().toISOString();
  try {
    const existing = await db.execute({
      sql: "SELECT user_id FROM ea_settings WHERE user_id = ?",
      args: [userId()],
    });
    if (!existing.rows.length) {
      await db.execute({ sql: "INSERT INTO ea_settings (user_id) VALUES (?)", args: [userId()] });
    }
    await db.execute({
      sql: "UPDATE ea_settings SET news_last_seen_at = ? WHERE user_id = ?",
      args: [at, userId()],
    });
    res.json({ ok: true, at });
  } catch (err) {
    console.error("Error updating news seen marker:", err);
    res.status(500).json({ message: "Failed to update seen marker" });
  }
});

router.post("/refresh", async (_req, res) => {
  try {
    res.json(await requestImmediateNewsSweep());
  } catch (err) {
    console.error("Error refreshing news:", err);
    res.status(500).json({ message: "Failed to refresh news" });
  }
});

export default router;
