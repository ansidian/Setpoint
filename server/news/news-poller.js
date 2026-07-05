// server/news/news-poller.js
// Poll worker for news feeds: conditional GET, normalize, upsert, prune.
// All IO is injectable (dbClient, fetchImpl) so tests never touch the network.
import Parser from "rss-parser";
import db from "../db/connection.js";
import {
  canonicalizeNewsUrl, excerptFromHtml, resolveSourceFeedUrl, shouldPollSource,
} from "./news-model.js";

export const NEWS_USER_AGENT = "SetpointNews/1.0 (personal dashboard; single user)";
export const NEWS_POLL_INTERVAL_MS = 20 * 60 * 1000;
const NEWS_FETCH_TIMEOUT_MS = 10_000;
const NEWS_RETENTION_DAYS = 14;
const NEWS_RETAINED_PER_SOURCE = 30;
const MANUAL_SWEEP_MIN_GAP_MS = 60_000;

const parser = new Parser({
  customFields: {
    item: [
      ["media:thumbnail", "mediaThumbnail"],
      ["media:content", "mediaContent"],
      ["media:group", "mediaGroup"],
    ],
  },
});

export function parseFeedXml(xml) {
  return parser.parseString(xml);
}

export async function fetchFeedResponse(url, {
  etag = null, lastModified = null, fetchImpl = fetch, timeoutMs = NEWS_FETCH_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": NEWS_USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
        ...(etag ? { "If-None-Match": etag } : {}),
        ...(lastModified ? { "If-Modified-Since": lastModified } : {}),
      },
    });
    const body = response.status === 200 ? await response.text() : "";
    return {
      status: response.status,
      body,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Last-resort thumbnail: feeds like The Verge ship images only as <img> tags
// inside the content html. Only absolute http(s) URLs qualify.
function firstImageFromHtml(html) {
  const match = /<img\b[^>]*\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(String(html || ""));
  return match ? match[1] : null;
}

export function normalizeFeedItem(raw) {
  const url = String(raw.link || "").trim();
  const guid = String(raw.guid || raw.id || url || raw.title || "").trim();
  let publishedAt = null;
  const rawDate = raw.isoDate || raw.pubDate;
  if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) publishedAt = parsed.toISOString();
  }
  const thumbnail = raw.mediaThumbnail?.$?.url
    || raw.mediaContent?.$?.url
    || raw.mediaGroup?.["media:thumbnail"]?.[0]?.$?.url // YouTube nests thumbnails in media:group
    || raw.enclosure?.url
    || firstImageFromHtml(raw["content:encoded"] || raw.content)
    || null;
  return {
    guid,
    url,
    canonical_url: canonicalizeNewsUrl(url),
    title: excerptFromHtml(raw.title || "", 300) || "(untitled)",
    excerpt: excerptFromHtml(raw.contentSnippet || raw.summary || raw.content || "", 280),
    author: raw.creator || raw.author || null,
    published_at: publishedAt,
    thumbnail_url: thumbnail,
  };
}

async function recordSourceFailure(source, status, { dbClient, nowIso }) {
  await dbClient.execute({
    sql: `UPDATE ea_news_sources
          SET last_fetch_at = ?, last_status = ?, consecutive_failures = consecutive_failures + 1
          WHERE id = ?`,
    args: [nowIso, status, source.id],
  });
}

export async function syncNewsSource(source, { dbClient = db, fetchImpl = fetch, now = new Date() } = {}) {
  const nowIso = new Date(now).toISOString();
  let response;
  try {
    response = await fetchFeedResponse(resolveSourceFeedUrl(source), {
      etag: source.etag, lastModified: source.last_modified, fetchImpl,
    });
  } catch (err) {
    const status = err?.name === "AbortError" ? "timeout" : "fetch_error";
    await recordSourceFailure(source, status, { dbClient, nowIso });
    return { ok: false, status };
  }
  if (response.status === 304) {
    await dbClient.execute({
      sql: "UPDATE ea_news_sources SET last_fetch_at = ?, last_status = '304', consecutive_failures = 0 WHERE id = ?",
      args: [nowIso, source.id],
    });
    return { ok: true, status: "304", inserted: 0 };
  }
  if (response.status !== 200) {
    await recordSourceFailure(source, String(response.status), { dbClient, nowIso });
    return { ok: false, status: String(response.status) };
  }
  let feed;
  try {
    feed = await parseFeedXml(response.body);
  } catch {
    await recordSourceFailure(source, "parse_error", { dbClient, nowIso });
    return { ok: false, status: "parse_error" };
  }
  const items = (feed.items || []).map(normalizeFeedItem).filter((item) => item.guid && item.url);
  let inserted = 0;
  for (const item of items) {
    const result = await dbClient.execute({
      sql: `INSERT INTO ea_news_items
              (source_id, guid, url, canonical_url, title, excerpt, author, published_at, fetched_at, thumbnail_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source_id, guid) DO NOTHING`,
      args: [source.id, item.guid, item.url, item.canonical_url, item.title, item.excerpt,
        item.author, item.published_at, nowIso, item.thumbnail_url],
    });
    inserted += result.rowsAffected || 0;
  }
  // 301 self-heal: persist where the redirect chain landed (rss only; hn URLs
  // are rebuilt from hn_query/min_points every poll).
  const finalUrl = source.kind === "rss" && response.finalUrl && response.finalUrl !== source.feed_url
    ? response.finalUrl
    : source.feed_url;
  await dbClient.execute({
    sql: `UPDATE ea_news_sources
          SET etag = ?, last_modified = ?, last_fetch_at = ?, last_status = '200',
              consecutive_failures = 0, feed_url = ?
          WHERE id = ?`,
    args: [response.etag, response.lastModified, nowIso, finalUrl, source.id],
  });
  return { ok: true, status: "200", inserted };
}

export async function pruneNewsItems({ dbClient = db, now = new Date() } = {}) {
  const cutoff = new Date(new Date(now).getTime() - NEWS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await dbClient.execute({
    sql: `DELETE FROM ea_news_items WHERE id IN (
            SELECT id FROM (
              SELECT id, fetched_at,
                     ROW_NUMBER() OVER (
                       PARTITION BY source_id
                       ORDER BY COALESCE(published_at, fetched_at) DESC
                     ) AS rank
              FROM ea_news_items
            ) WHERE rank > ? AND fetched_at < ?
          )`,
    args: [NEWS_RETAINED_PER_SOURCE, cutoff],
  });
}

// Reddit 429s back-to-back anonymous requests, so a sweep fetches at most one
// source per limited host; the rest defer to a later sweep. Sorting the due
// list least-recently-fetched-first makes deferred same-host sources rotate
// fairly instead of starving behind the same winner every sweep.
const ONE_FETCH_PER_SWEEP_HOSTS = ["reddit.com"];

function rateLimitedFeedHost(feedUrl) {
  let host;
  try {
    host = new URL(feedUrl).hostname;
  } catch {
    return null;
  }
  return ONE_FETCH_PER_SWEEP_HOSTS.find((limited) => host === limited || host.endsWith(`.${limited}`)) ?? null;
}

let sweepInFlight = false;

export async function sweepNewsSources({
  dbClient = db, fetchImpl = fetch, now = new Date(), staggerMs = 250,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (sweepInFlight) return { swept: 0, skipped: true };
  sweepInFlight = true;
  try {
    const result = await dbClient.execute({ sql: "SELECT * FROM ea_news_sources WHERE enabled = 1", args: [] });
    const due = (result.rows || [])
      .filter((source) => shouldPollSource(source, now))
      .sort((a, b) => String(a.last_fetch_at || "").localeCompare(String(b.last_fetch_at || "")));
    const fetchedLimitedHosts = new Set();
    let swept = 0;
    for (const source of due) {
      const limitedHost = rateLimitedFeedHost(resolveSourceFeedUrl(source));
      if (limitedHost) {
        if (fetchedLimitedHosts.has(limitedHost)) continue;
        fetchedLimitedHosts.add(limitedHost);
      }
      await syncNewsSource(source, { dbClient, fetchImpl, now });
      swept += 1;
      if (staggerMs) await sleep(staggerMs);
    }
    await pruneNewsItems({ dbClient, now });
    return { swept, skipped: false };
  } finally {
    sweepInFlight = false;
  }
}

let lastManualSweepAt = 0;

export async function requestImmediateNewsSweep(opts = {}) {
  const nowMs = Date.now();
  if (nowMs - lastManualSweepAt < MANUAL_SWEEP_MIN_GAP_MS) return { swept: 0, throttled: true };
  lastManualSweepAt = nowMs;
  const result = await sweepNewsSources(opts);
  return { ...result, throttled: false };
}

let newsPollWorkerTimer = null;

export function startNewsPollWorker({ intervalMs = NEWS_POLL_INTERVAL_MS, dbClient = db } = {}) {
  if (newsPollWorkerTimer) return { started: false };
  const run = () => {
    sweepNewsSources({ dbClient }).catch((err) => console.error("news poll sweep failed:", err));
  };
  run();
  newsPollWorkerTimer = setInterval(run, intervalMs);
  newsPollWorkerTimer.unref?.();
  return { started: true };
}

export function stopNewsPollWorker() {
  if (newsPollWorkerTimer) {
    clearInterval(newsPollWorkerTimer);
    newsPollWorkerTimer = null;
  }
}
