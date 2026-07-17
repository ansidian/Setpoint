import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import type { NewsPageEnvelope } from "../../../shared/types/news.ts";

const hookState = vi.hoisted<{ news: NewsPageEnvelope | null }>(() => ({ news: null }));
// useNews resolves the initial fetch asynchronously in the real app, which
// gives NewsTab a genuine news-identity change to adopt the divider marker
// from. Mirror that here with an effect-driven state flip rather than
// returning the same object reference on every render.
function useFakeNews() {
  const [news, setNews] = useState<NewsPageEnvelope | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      if (!cancelled) setNews(hookState.news);
    });
    return () => { cancelled = true; };
  }, []);
  return { news, loading: false, error: null, refreshing: false, reload: vi.fn(), refresh: vi.fn() };
}
vi.mock("../../hooks/useNews", () => ({
  default: useFakeNews,
}));

// NewsTab's import graph (manage panel, add-source form, catalog picker) pulls
// in the whole news API surface at module load — mock all of it.
const api = vi.hoisted(() => ({
  markNewsSeen: vi.fn(async () => ({ ok: true })),
  createNewsTopic: vi.fn(), renameNewsTopic: vi.fn(), reorderNewsTopics: vi.fn(),
  deleteNewsTopic: vi.fn(), updateNewsSource: vi.fn(), deleteNewsSource: vi.fn(),
  previewNewsSource: vi.fn(), createNewsSource: vi.fn(),
  getNewsCatalog: vi.fn(async () => ({ topics: [] })), importNewsStarterTopics: vi.fn(),
}));
vi.mock("../../api", () => api);

const { default: NewsTab } = await import("./NewsTab");

afterEach(() => {
  cleanup();
  window.localStorage?.clear();
});

describe("NewsTab mark-all-seen", () => {
  it("bumps the marker via the API and re-splits the page immediately", async () => {
    hookState.news = {
      lastSeenAt: "2026-07-04T10:00:00.000Z",
      lastUpdatedAt: "2026-07-04T11:55:00.000Z",
      topics: [{
        id: 1, name: "AI", position: 0, sources: [],
        items: [{ id: 100, sourceId: 10, sourceTitle: "Feed", siteUrl: null, url: "https://t/a", title: "Fresh story",
          excerpt: "", author: null, publishedAt: "2026-07-04T11:00:00.000Z", thumbnailUrl: null }],
        mutedTerms: [],
      }],
    };
    render(<NewsTab active />);
    const topic = await screen.findByRole("region", { name: "AI" });
    expect(within(topic).getByText(/1 new/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /mark caught up/i }));
    expect(api.markNewsSeen).toHaveBeenCalledTimes(1);
    expect(within(topic).queryByText(/1 new/)).toBeNull(); // item re-split to older, pill gone
  });

  it("opens source management on the affected topic from its health cue", async () => {
    hookState.news = {
      lastSeenAt: null,
      lastUpdatedAt: "2026-07-04T11:55:00.000Z",
      topics: [{
        id: 2, name: "Politics", position: 0,
        sources: [{
          id: 20, topicId: 2, kind: "rss", title: "Reddit · r/politics",
          feedUrl: "https://www.reddit.com/r/politics/.rss", siteUrl: "https://reddit.com/r/politics",
          enabled: true, lastStatus: "429", lastFetchAt: "2026-07-04T11:30:00.000Z",
          consecutiveFailures: 6, hnQuery: null, minPoints: null,
        }],
        items: [],
        mutedTerms: [],
      }],
    };
    render(<NewsTab active />);
    fireEvent.click(await screen.findByRole("button", { name: /reddit delayed · 429/i }));
    expect(screen.getByRole("button", { name: /back to topics/i })).toBeTruthy();
  });

  it("closes source management when the News tab becomes inactive", async () => {
    hookState.news = {
      lastSeenAt: null,
      lastUpdatedAt: null,
      topics: [{ id: 1, name: "AI", position: 0, sources: [], items: [], mutedTerms: [] }],
    };
    const { rerender } = render(<NewsTab active />);
    fireEvent.click(await screen.findByRole("button", { name: /^sources$/i }));
    expect(screen.getByRole("dialog", { name: "Sources" })).toBeTruthy();

    rerender(<NewsTab active={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<NewsTab active />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
