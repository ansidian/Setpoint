import {
  NO_DEMO_API_RESPONSE,
  demoPathSegment,
  type DemoApiRequest,
} from "./apiHandler.ts";
import type { NewsSource } from "../../shared/types/news.ts";

const clone = <T>(value: T): T => value == null ? value : structuredClone(value);

export function handleDemoNewsRequest({ pathname, method, seed, body }: DemoApiRequest): unknown {
  if (pathname === "/api/news/seen" && method === "POST") {
    seed.news.lastSeenAt = body.at || new Date().toISOString();
    return { ok: true, at: seed.news.lastSeenAt };
  }

  if (pathname === "/api/news/refresh" && method === "POST") return { swept: 0, throttled: false };

  if (pathname === "/api/news/topics" && method === "POST") {
    const name = body.name || "Demo topic";
    const id = Math.max(0, ...seed.news.topics.map((topic) => topic.id)) + 1;
    seed.news.topics.push({ id, name, position: seed.news.topics.length, sources: [], items: [], mutedTerms: [] });
    return { id, name };
  }

  if (pathname === "/api/news/topics/reorder" && method === "POST") {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    seed.news.topics.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    seed.news.topics.forEach((topic, index) => { topic.position = index; });
    return { ok: true };
  }

  if (pathname === "/api/news/topics/import-starter" && method === "POST") {
    return { imported: body.names || [] };
  }

  if (pathname.match(/^\/api\/news\/topics\/[^/]+$/) && method === "PATCH") {
    const id = Number(demoPathSegment(pathname, 1));
    const topic = seed.news.topics.find((entry) => entry.id === id);
    if (topic) topic.name = body.name || topic.name;
    if (topic && Array.isArray(body.mutedTerms)) topic.mutedTerms = body.mutedTerms;
    return { ok: true };
  }

  if (pathname.match(/^\/api\/news\/topics\/[^/]+$/) && method === "DELETE") {
    const id = Number(demoPathSegment(pathname, 1));
    seed.news.topics = seed.news.topics.filter((topic) => topic.id !== id);
    return { ok: true };
  }

  if (pathname === "/api/news/sources/preview" && method === "POST") {
    return { feedUrl: "https://demo.example/feed", title: "Demo Feed", sampleTitles: ["Sample headline"] };
  }

  if (pathname === "/api/news/sources" && method === "POST") {
    const topic = seed.news.topics.find((entry) => entry.id === Number(body.topicId));
    const id = Date.now() % 100000;
    const source: NewsSource = {
      id,
      topicId: body.topicId ?? 0,
      kind: body.kind || "rss",
      title: body.title || "Demo source",
      feedUrl: body.feedUrl || "https://demo.example/feed",
      siteUrl: body.siteUrl || null,
      enabled: true,
      hnQuery: body.hnQuery ?? null,
      minPoints: body.minPoints ?? null,
      lastStatus: null,
      lastFetchAt: null,
      consecutiveFailures: 0,
    };
    if (topic) topic.sources.push(source);
    return { source };
  }

  if (pathname.match(/^\/api\/news\/sources\/[^/]+$/) && (method === "PATCH" || method === "DELETE")) {
    const id = Number(demoPathSegment(pathname, 1));
    for (const topic of seed.news.topics) {
      if (method === "DELETE") {
        topic.sources = topic.sources.filter((source) => source.id !== id);
        topic.items = topic.items.filter((item) => item.sourceId !== id);
      } else {
        const source = topic.sources.find((entry) => entry.id === id);
        if (source) Object.assign(source, body);
      }
    }
    return { ok: true };
  }

  if (pathname === "/api/news" && method === "GET") return clone(seed.news);
  if (pathname === "/api/news/catalog" && method === "GET") {
    return { topics: [{ name: "3D Printing", sources: [] }, { name: "AI", sources: [] }] };
  }
  return NO_DEMO_API_RESPONSE;
}

