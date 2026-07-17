// server/news/news-model.js
// Pure domain rules for the News tab. No IO, no db — everything here is
// table-driven testable. Poller/routes import from here.
import type {
  NewsItem,
  NewsPageEnvelope,
  NewsSource,
  NewsSourceKind,
  NewsTopic,
} from "../../shared/types/news.ts";

export interface NewsSourceRow {
  id: number;
  topic_id: number;
  kind: NewsSourceKind;
  title: string;
  feed_url: string;
  site_url?: string | null;
  enabled?: boolean | number;
  hn_query?: string | null;
  min_points?: number | null;
  last_status?: string | null;
  last_fetch_at?: string | null;
  consecutive_failures?: number | null;
  etag?: string | null;
  last_modified?: string | null;
  retry_after_at?: string | null;
}

export interface NewsItemRow {
  id: number;
  source_id: number;
  guid?: string;
  url: string;
  canonical_url?: string | null;
  title: string;
  excerpt?: string | null;
  author?: string | null;
  published_at?: string | null;
  fetched_at?: string | null;
  thumbnail_url?: string | null;
}

export interface NewsTopicRow {
  id: number;
  user_id?: string;
  name: string;
  position: number;
  muted_terms?: string | null;
}

type HnFeedOptions = { query?: unknown; minPoints?: number | null };
type NewsFeedSource = Pick<NewsSourceRow, "kind" | "feed_url"> &
  Partial<Pick<NewsSourceRow, "hn_query" | "min_points">>;
type PollableNewsSource = Partial<Pick<NewsSourceRow, "enabled" | "consecutive_failures" | "last_fetch_at">>;
type KeyedNewsItem = { canonical_url?: string | null; url?: string };

const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref)$/i;
const FAILURE_BACKOFF_THRESHOLD = 5;
const FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const NEWS_ITEMS_PER_TOPIC = 30;

export function canonicalizeNewsUrl(rawUrl: unknown): string {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    return String(rawUrl ?? "").trim();
  }
  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  return url.toString().replace(/\/$/, "").replace(/\/\?/, "?");
}

export function buildHnFeedUrl({ query = "", minPoints = 50 }: HnFeedOptions = {}): string {
  const points = typeof minPoints === "number" && Number.isFinite(minPoints) && minPoints > 0
    ? Math.round(minPoints)
    : 50;
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return `https://hnrss.org/frontpage?points=${points}`;
  return `https://hnrss.org/newest?q=${encodeURIComponent(trimmed)}&points=${points}`;
}

export function resolveSourceFeedUrl(source: NewsFeedSource): string {
  if (source.kind === "hn") {
    return buildHnFeedUrl({ query: source.hn_query ?? "", minPoints: source.min_points ?? 50 });
  }
  return source.feed_url;
}

export function shouldPollSource(source: PollableNewsSource | null | undefined, now: Date | string | number = new Date()): boolean {
  if (!source?.enabled) return false;
  if ((source.consecutive_failures || 0) < FAILURE_BACKOFF_THRESHOLD) return true;
  if (!source.last_fetch_at) return true;
  return new Date(now).getTime() - new Date(source.last_fetch_at).getTime() >= FAILURE_BACKOFF_MS;
}

export function excerptFromHtml(html: unknown, maxChars = 280): string {
  if (!html) return "";
  const text = String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function newsItemKey(item: KeyedNewsItem): string | undefined {
  return item.canonical_url || item.url;
}

export function dedupeByCanonicalUrl<T extends KeyedNewsItem>(items: T[]): T[] {
  const seen = new Set<string | undefined>();
  const out: T[] = [];
  for (const item of items) {
    const key = newsItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function itemRecency(item: Pick<NewsItemRow, "published_at" | "fetched_at">): string {
  return String(item.published_at || item.fetched_at || "");
}

export function parseMutedTerms(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((term): term is string => typeof term === "string" && Boolean(term.trim()));
  } catch {
    return [];
  }
}

const MUTED_TERMS_MAX = 50;
const MUTED_TERM_MAX_LENGTH = 80;

// Returns the cleaned list, or null when the input is not a valid terms array
// (route answers 400 on null). Empty array is valid — it clears the filter.
export function sanitizeMutedTerms(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > MUTED_TERMS_MAX) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const term = raw.trim();
    if (!term) continue;
    if (term.length > MUTED_TERM_MAX_LENGTH) return null;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Word-boundary, case-insensitive, title-only. Custom lookarounds instead of
// \b because muted terms may start/end with non-word chars ("c++", ".net").
export function isTitleMuted(title: unknown, terms: string[]): boolean {
  if (!terms?.length) return false;
  const text = String(title ?? "");
  return terms.some((term) =>
    new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(term)}(?![A-Za-z0-9_])`, "i").test(text));
}

function shapeSource(row: NewsSourceRow): NewsSource {
  return {
    id: row.id,
    topicId: row.topic_id,
    kind: row.kind,
    title: row.title,
    feedUrl: row.feed_url,
    siteUrl: row.site_url ?? null,
    enabled: Boolean(row.enabled),
    hnQuery: row.hn_query ?? null,
    minPoints: row.min_points ?? null,
    lastStatus: row.last_status ?? null,
    lastFetchAt: row.last_fetch_at ?? null,
    consecutiveFailures: row.consecutive_failures || 0,
  };
}

function shapeItem(row: NewsItemRow, source: NewsSourceRow | undefined): NewsItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceTitle: source?.title ?? "",
    siteUrl: source?.site_url ?? null,
    url: row.url,
    title: row.title,
    excerpt: row.excerpt ?? "",
    author: row.author ?? null,
    publishedAt: row.published_at ?? row.fetched_at ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
  };
}

export function buildNewsPagePayload({
  topics,
  sources,
  items,
  lastSeenAt = null,
}: {
  topics: NewsTopicRow[];
  sources: NewsSourceRow[];
  items: NewsItemRow[];
  lastSeenAt?: string | null;
}): NewsPageEnvelope {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const sourcesByTopic = new Map<number, NewsSourceRow[]>();
  for (const source of sources) {
    const list = sourcesByTopic.get(source.topic_id) || [];
    list.push(source);
    sourcesByTopic.set(source.topic_id, list);
  }
  const itemsBySource = new Map<number, NewsItemRow[]>();
  for (const item of items) {
    const list = itemsBySource.get(item.source_id) || [];
    list.push(item);
    itemsBySource.set(item.source_id, list);
  }
  let lastUpdatedAt: string | null = null;
  for (const source of sources) {
    if (source.last_fetch_at && (!lastUpdatedAt || source.last_fetch_at > lastUpdatedAt)) {
      lastUpdatedAt = source.last_fetch_at;
    }
  }
  const pageSeenUrls = new Set<string>();
  const shapedTopics: NewsTopic[] = [...topics]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((topic) => {
      const topicSources = sourcesByTopic.get(topic.id) || [];
      const mutedTerms = parseMutedTerms(topic.muted_terms);
      const topicItems = topicSources
        .flatMap((source) => itemsBySource.get(source.id) || [])
        .filter((item) => !isTitleMuted(item.title, mutedTerms))
        .sort((a, b) => itemRecency(b).localeCompare(itemRecency(a)));
      const deduped = dedupeByCanonicalUrl(topicItems)
        .filter((item) => !pageSeenUrls.has(newsItemKey(item)!));
      const visible = deduped.slice(0, NEWS_ITEMS_PER_TOPIC);
      for (const item of visible) pageSeenUrls.add(newsItemKey(item)!);
      return {
        id: topic.id,
        name: topic.name,
        position: topic.position,
        sources: topicSources.map(shapeSource),
        items: visible.map((item) => shapeItem(item, sourceById.get(item.source_id))),
        mutedTerms,
      };
    });
  return { lastSeenAt, lastUpdatedAt, topics: shapedTopics };
}
