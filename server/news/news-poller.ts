// server/news/news-poller.js
// Poll worker for news feeds: conditional GET, normalize, upsert, prune.
// All IO is injectable (dbClient, fetchImpl) so tests never touch the network.
import Parser from "rss-parser";
import type { Client } from "@libsql/client";
import db from "../db/connection.ts";
import {
  canonicalizeNewsUrl, excerptFromHtml, resolveSourceFeedUrl, shouldPollSource,
} from "./news-model.ts";
import type { NewsSourceRow } from "./news-model.ts";

type NewsDbClient = Pick<Client, "execute">;
export interface FeedFetchResponse {
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type NewsFetch = (url: string, init?: RequestInit) => Promise<FeedFetchResponse>;

interface RawFeedMedia {
  $?: { url?: string };
}

interface RawFeedItem extends Parser.Item {
  id?: string;
  author?: string;
  "content:encoded"?: string;
  mediaThumbnail?: RawFeedMedia;
  mediaContent?: RawFeedMedia;
  mediaGroup?: { "media:thumbnail"?: RawFeedMedia[] };
}

export interface NormalizedFeedItem {
  guid: string;
  url: string;
  canonical_url: string;
  title: string;
  excerpt: string;
  author: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
}

interface FetchFeedOptions {
  etag?: string | null;
  lastModified?: string | null;
  fetchImpl?: NewsFetch;
  timeoutMs?: number;
}

export interface NewsFeedResponse {
  status: number;
  body: string;
  etag: string | null;
  lastModified: string | null;
  retryAfter: string | null;
  finalUrl: string;
}

interface NewsIoOptions {
  dbClient?: NewsDbClient;
  fetchImpl?: NewsFetch;
  now?: Date | string | number;
}

export const NEWS_USER_AGENT = "SetpointNews/1.0 (personal dashboard; single user)";
export const NEWS_POLL_INTERVAL_MS = 20 * 60 * 1000;
const NEWS_FETCH_TIMEOUT_MS = 10_000;
const NEWS_RETENTION_DAYS = 14;
const NEWS_RETAINED_PER_SOURCE = 30;
const MANUAL_SWEEP_MIN_GAP_MS = 60_000;

export function parseRetryAfterAt(value: unknown, now: Date | string | number = new Date()): string | null {
  const raw = String(value ?? "").trim();
  const nowMs = new Date(now).getTime();
  if (!raw || !Number.isFinite(nowMs)) return null;
  if (/^\d+$/.test(raw)) {
    const targetMs = nowMs + Number(raw) * 1000;
    const target = new Date(targetMs);
    return Number.isFinite(target.getTime()) ? target.toISOString() : null;
  }
  const targetMs = Date.parse(raw);
  if (!Number.isFinite(targetMs)) return null;
  return new Date(targetMs).toISOString();
}

const parser = new Parser<Record<string, unknown>, RawFeedItem>({
  customFields: {
    item: [
      ["media:thumbnail", "mediaThumbnail"],
      ["media:content", "mediaContent"],
      ["media:group", "mediaGroup"],
    ],
  },
});

export function parseFeedXml(xml: string): Promise<Parser.Output<RawFeedItem>> {
  return parser.parseString(xml);
}

export async function fetchFeedResponse(url: string, {
  etag = null, lastModified = null, fetchImpl = fetch, timeoutMs = NEWS_FETCH_TIMEOUT_MS,
}: FetchFeedOptions = {}): Promise<NewsFeedResponse> {
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
      retryAfter: response.headers.get("retry-after"),
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Last-resort thumbnail: feeds like The Verge ship images only as <img> tags
// inside the content html. Only absolute http(s) URLs qualify.
function firstImageFromHtml(html: unknown): string | null {
  const match = /<img\b[^>]*\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(String(html || ""));
  return match?.[1] ?? null;
}

export function normalizeFeedItem(raw: RawFeedItem): NormalizedFeedItem {
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

async function recordSourceFailure(
  source: NewsSourceRow,
  status: string,
  { dbClient, nowIso, retryAfterAt = null }: {
    dbClient: NewsDbClient;
    nowIso: string;
    retryAfterAt?: string | null;
  },
): Promise<void> {
  await dbClient.execute({
    sql: `UPDATE ea_news_sources
          SET last_fetch_at = ?, last_status = ?, consecutive_failures = consecutive_failures + 1,
              retry_after_at = ?
          WHERE id = ?`,
    args: [nowIso, status, retryAfterAt, source.id],
  });
}

export async function syncNewsSource(
  source: NewsSourceRow,
  { dbClient = db, fetchImpl = fetch, now = new Date() }: NewsIoOptions = {},
): Promise<{ ok: boolean; status: string; inserted?: number }> {
  const nowIso = new Date(now).toISOString();
  let response;
  try {
    response = await fetchFeedResponse(resolveSourceFeedUrl(source), {
      etag: source.etag, lastModified: source.last_modified, fetchImpl,
    });
  } catch (err) {
    const status = err instanceof Error && err.name === "AbortError" ? "timeout" : "fetch_error";
    await recordSourceFailure(source, status, { dbClient, nowIso });
    return { ok: false, status };
  }
  if (response.status === 304) {
    await dbClient.execute({
      sql: `UPDATE ea_news_sources
            SET last_fetch_at = ?, last_status = '304', consecutive_failures = 0,
                retry_after_at = NULL
            WHERE id = ?`,
      args: [nowIso, source.id],
    });
    return { ok: true, status: "304", inserted: 0 };
  }
  if (response.status !== 200) {
    const retryAfterAt = response.status === 429 ? parseRetryAfterAt(response.retryAfter, now) : null;
    await recordSourceFailure(source, String(response.status), { dbClient, nowIso, retryAfterAt });
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
              consecutive_failures = 0, retry_after_at = NULL, feed_url = ?
          WHERE id = ?`,
    args: [response.etag, response.lastModified, nowIso, finalUrl, source.id],
  });
  return { ok: true, status: "200", inserted };
}

export async function pruneNewsItems({ dbClient = db, now = new Date() }: Pick<NewsIoOptions, "dbClient" | "now"> = {}): Promise<void> {
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
const LIMITED_HOST_429_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function rateLimitedFeedHost(feedUrl: string): string | null {
  let host: string;
  try {
    host = new URL(feedUrl).hostname;
  } catch {
    return null;
  }
  return ONE_FETCH_PER_SWEEP_HOSTS.find((limited) => host === limited || host.endsWith(`.${limited}`)) ?? null;
}

function rateLimitedHostsOnCooldown(sources: NewsSourceRow[], now: Date | string | number): Set<string> {
  const nowMs = new Date(now).getTime();
  const coolingDown = new Set<string>();
  for (const source of sources) {
    if (String(source.last_status) !== "429" || !source.last_fetch_at) continue;
    const limitedHost = rateLimitedFeedHost(resolveSourceFeedUrl(source));
    if (!limitedHost) continue;
    if (source.retry_after_at) {
      const retryAfterMs = new Date(source.retry_after_at).getTime();
      if (Number.isFinite(retryAfterMs)) {
        if (nowMs < retryAfterMs) coolingDown.add(limitedHost);
        continue;
      }
    }
    const lastFetchMs = new Date(source.last_fetch_at).getTime();
    if (Number.isFinite(lastFetchMs) && nowMs - lastFetchMs < LIMITED_HOST_429_COOLDOWN_MS) {
      coolingDown.add(limitedHost);
    }
  }
  return coolingDown;
}

let sweepInFlight = false;

export async function sweepNewsSources({
  dbClient = db, fetchImpl = fetch, now = new Date(), staggerMs = 250,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: NewsIoOptions & { staggerMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ swept: number; skipped: boolean }> {
  if (sweepInFlight) return { swept: 0, skipped: true };
  sweepInFlight = true;
  try {
    const result = await dbClient.execute({ sql: "SELECT * FROM ea_news_sources", args: [] });
    const sources = (result.rows || []) as unknown as NewsSourceRow[];
    const coolingDownLimitedHosts = rateLimitedHostsOnCooldown(sources, now);
    const due = sources
      .filter((source) => shouldPollSource(source, now))
      .sort((a, b) => String(a.last_fetch_at || "").localeCompare(String(b.last_fetch_at || "")));
    const fetchedLimitedHosts = new Set<string>();
    let swept = 0;
    for (const source of due) {
      const limitedHost = rateLimitedFeedHost(resolveSourceFeedUrl(source));
      if (limitedHost) {
        if (coolingDownLimitedHosts.has(limitedHost)) continue;
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

export async function requestImmediateNewsSweep(
  opts: NewsIoOptions & { staggerMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ swept: number; skipped?: boolean; throttled: boolean }> {
  const nowMs = Date.now();
  if (nowMs - lastManualSweepAt < MANUAL_SWEEP_MIN_GAP_MS) return { swept: 0, throttled: true };
  lastManualSweepAt = nowMs;
  const result = await sweepNewsSources(opts);
  return { ...result, throttled: false };
}

let newsPollWorkerTimer: ReturnType<typeof setInterval> | null = null;

export function startNewsPollWorker({
  intervalMs = NEWS_POLL_INTERVAL_MS,
  dbClient = db,
}: { intervalMs?: number; dbClient?: NewsDbClient } = {}): { started: boolean } {
  if (newsPollWorkerTimer) return { started: false };
  const run = () => {
    sweepNewsSources({ dbClient }).catch((err) => console.error("news poll sweep failed:", err));
  };
  run();
  newsPollWorkerTimer = setInterval(run, intervalMs);
  newsPollWorkerTimer.unref?.();
  return { started: true };
}

export function stopNewsPollWorker(): void {
  if (newsPollWorkerTimer) {
    clearInterval(newsPollWorkerTimer);
    newsPollWorkerTimer = null;
  }
}
