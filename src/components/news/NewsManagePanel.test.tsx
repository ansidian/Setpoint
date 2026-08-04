import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsPageEnvelope } from "../../../shared/types/news.ts";
import NewsManagePanel from "./NewsManagePanel";

interface RequestRecord { path: string; method: string; body: unknown }
let requests: RequestRecord[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    if (path === "/api/news/sources/preview") return json({ feedUrl: "https://x/feed", title: "X Feed", sampleTitles: ["Hello"] });
    if (path === "/api/news/sources") return json({ source: { id: 30 } });
    if (path === "/api/news/catalog") return json({ topics: [] });
    return json({ ok: true });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const news: NewsPageEnvelope = {
  lastSeenAt: null, lastUpdatedAt: null,
  topics: [{
    id: 1, name: "AI", position: 0,
    sources: [{ id: 10, topicId: 1, kind: "rss", title: "Feed A", feedUrl: "https://a/f", siteUrl: null,
      enabled: true, hnQuery: null, minPoints: null, lastStatus: "403", lastFetchAt: null, consecutiveFailures: 7 }],
    items: [],
    mutedTerms: ["crypto"],
  }],
};

describe("NewsManagePanel", () => {
  it("announces the Sources modal and moves focus inside it", async () => {
    render(<NewsManagePanel open onClose={() => {}} news={news} onChanged={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Sources" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /close/i }),
    ));
  });

  it("shows a topic overview before drilling into a topic", () => {
    render(<NewsManagePanel open onClose={() => {}} news={news} onChanged={() => {}} />);

    expect(screen.getByText("1/1 enabled")).toBeTruthy();
    expect(screen.getByText("1 feed needs attention")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /feed a/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /AI.*1\/1 enabled.*1 feed needs attention/i }));

    expect(screen.getByRole("checkbox", { name: /feed a/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /back to topics/i }));

    expect(screen.getByRole("button", { name: /AI.*1\/1 enabled.*1 feed needs attention/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /feed a/i })).toBeNull();
  });

  it("opens directly to the requested topic", () => {
    const focusedNews: NewsPageEnvelope = {
      ...news,
      topics: [
        ...news.topics,
        {
          id: 2, name: "Hardware", position: 1, items: [], mutedTerms: [],
          sources: [{
            id: 20, topicId: 2, kind: "rss", title: "Feed B", feedUrl: "https://b/f", siteUrl: null,
            enabled: true, hnQuery: null, minPoints: null, lastStatus: "200", lastFetchAt: null,
            consecutiveFailures: 0,
          }],
        },
      ],
    };

    render(
      <NewsManagePanel
        open
        initialTopicId={2}
        onClose={() => {}}
        news={focusedNews}
        onChanged={() => {}}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /feed b/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /feed a/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back to topics/i })).toBeTruthy();
  });

  it("toggling a source calls updateNewsSource and onChanged", async () => {
    render(<NewsManagePanel open initialTopicId={1} onClose={() => {}} news={news} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /feed a/i }));
    await waitFor(() => expect(requests).toContainEqual({ path: "/api/news/sources/10", method: "PATCH", body: { enabled: false } }));
  });

  it("shows a failing badge for a backed-off source", () => {
    render(<NewsManagePanel open initialTopicId={1} onClose={() => {}} news={news} onChanged={() => {}} />);
    expect(screen.getByText(/HTTP 403 · failing/)).toBeTruthy();
  });

  it("clears a pending topic deletion when returning to the overview", () => {
    render(<NewsManagePanel open initialTopicId={1} onClose={() => {}} news={news} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("button", { name: /confirm/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /back to topics/i }));
    fireEvent.click(screen.getByRole("button", { name: /AI.*1\/1 enabled.*1 feed needs attention/i }));

    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
  });

  it("add-source flow: check → confirm calls previewNewsSource then createNewsSource", async () => {
    render(<NewsManagePanel open initialTopicId={1} onClose={() => {}} news={news} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /add source/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste a site or feed url/i), {
      target: { value: "https://x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check/i }));
    await screen.findByText(/X Feed/);
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(requests).toContainEqual({
      path: "/api/news/sources", method: "POST",
      body: { topicId: 1, kind: "rss", feedUrl: "https://x/feed", title: "X Feed", siteUrl: "https://x.com" },
    }));
  });

  it("adds a mute term via the input and removes one via its chip", async () => {
    render(<NewsManagePanel open initialTopicId={1} onClose={() => {}} news={news} onChanged={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/mute keyword/i), { target: { value: " sponsored " } });
    fireEvent.keyDown(screen.getByPlaceholderText(/mute keyword/i), { key: "Enter" });
    await waitFor(() => expect(requests).toContainEqual({
      path: "/api/news/topics/1", method: "PATCH", body: { mutedTerms: ["crypto", "sponsored"] },
    }));
    fireEvent.click(screen.getByRole("button", { name: /unmute crypto/i }));
    await waitFor(() => expect(requests).toContainEqual({
      path: "/api/news/topics/1", method: "PATCH", body: { mutedTerms: [] },
    }));
  });
});
