import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsPageEnvelope } from "../../../shared/types/news.ts";
import NewsTab from "./NewsTab";

interface RequestRecord { path: string; method: string; body: unknown }
let newsPayload: NewsPageEnvelope;
let requests: RequestRecord[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    const body = path === "/api/news" ? newsPayload : path === "/api/news/catalog" ? { topics: [] } : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  cleanup();
  window.localStorage?.clear();
  vi.unstubAllGlobals();
});

describe("NewsTab mark-all-seen", () => {
  it("bumps the marker via the API and re-splits the page immediately", async () => {
    newsPayload = {
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
    await waitFor(() => expect(requests.some((request) => request.path === "/api/news/seen" && request.method === "POST")).toBe(true));
    expect(within(topic).queryByText(/1 new/)).toBeNull(); // item re-split to older, pill gone
  });

  it("opens source management on the affected topic from its health cue", async () => {
    newsPayload = {
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
    newsPayload = {
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
