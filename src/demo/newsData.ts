// src/demo/newsData.ts
// Demo News payload: same shape as GET /api/news. Mutations mutate this
// in-memory object; refresh resets it (demo contract: no persistence).
import type { NewsItem, NewsPageEnvelope } from "../../shared/types/news.ts";

function demoItem(id: number, sourceId: number, sourceTitle: string, title: string, minutesAgo: number): NewsItem {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id, sourceId, sourceTitle, siteUrl: null,
    url: `https://demo.example/article-${id}`,
    title, excerpt: "Demo excerpt for the walkthrough — click-through is disabled in demo mode.",
    author: null, publishedAt: at, thumbnailUrl: null,
  };
}

export function buildDemoNews(): NewsPageEnvelope {
  return {
    lastSeenAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    topics: [
      {
        id: 1, name: "PC Hardware", position: 0, mutedTerms: [],
        sources: [{ id: 10, topicId: 1, kind: "rss", title: "Demo Hardware Feed",
          feedUrl: "https://demo.example/feed", siteUrl: null, enabled: true, hnQuery: null,
          minPoints: null, lastStatus: "200", lastFetchAt: new Date().toISOString(), consecutiveFailures: 0 }],
        items: [
          demoItem(100, 10, "Demo Hardware Feed", "New GPU generation announced", 30),
          demoItem(101, 10, "Demo Hardware Feed", "SSD prices hit all-time low", 6 * 60),
        ],
      },
      {
        id: 2, name: "AI", position: 1, mutedTerms: [],
        sources: [{ id: 11, topicId: 2, kind: "hn", title: "Hacker News · AI",
          feedUrl: "https://hnrss.org/newest?q=AI&points=50", siteUrl: null, enabled: true,
          hnQuery: "AI", minPoints: 50, lastStatus: "200",
          lastFetchAt: new Date().toISOString(), consecutiveFailures: 0 }],
        items: [demoItem(102, 11, "Hacker News · AI", "Open-source model tops new benchmark", 90)],
      },
    ],
  };
}
