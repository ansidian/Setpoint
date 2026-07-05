import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";

const hookState = vi.hoisted(() => ({ news: null }));
// useNews resolves the initial fetch asynchronously in the real app, which
// gives NewsTab a genuine news-identity change to adopt the divider marker
// from. Mirror that here with an effect-driven state flip rather than
// returning the same object reference on every render.
function useFakeNews() {
  const [news, setNews] = useState(null);
  useEffect(() => {
    setNews(hookState.news);
  }, []);
  return { news, loading: false, error: null, refreshing: false, reload: vi.fn(), refresh: vi.fn() };
}
vi.mock("../../hooks/useNews.js", () => ({
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
vi.mock("../../api.js", () => api);

const { default: NewsTab } = await import("./NewsTab.jsx");

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("NewsTab mark-all-seen", () => {
  it("bumps the marker via the API and re-splits the page immediately", async () => {
    hookState.news = {
      lastSeenAt: "2026-07-04T10:00:00.000Z",
      lastUpdatedAt: "2026-07-04T11:55:00.000Z",
      topics: [{
        id: 1, name: "AI", position: 0, sources: [],
        items: [{ id: 100, sourceId: 10, sourceTitle: "Feed", url: "https://t/a", title: "Fresh story",
          excerpt: "", author: null, publishedAt: "2026-07-04T11:00:00.000Z", thumbnailUrl: null }],
      }],
    };
    render(<NewsTab active />);
    expect(screen.getByText(/1 new/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /mark all seen/i }));
    expect(api.markNewsSeen).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/1 new/)).toBeNull(); // item re-split to older, pill gone
  });
});
