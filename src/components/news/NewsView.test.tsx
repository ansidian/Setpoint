import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NewsPageEnvelope } from "../../../shared/types/news.ts";
import NewsView from "./NewsView";

afterEach(cleanup);

const payload: NewsPageEnvelope = {
  lastSeenAt: "2026-07-04T10:00:00.000Z",
  lastUpdatedAt: "2026-07-04T11:55:00.000Z",
  topics: [
    {
      id: 1,
      name: "PC Hardware",
      position: 0,
      sources: [],
      items: [{
        id: 100,
        sourceId: 10,
        sourceTitle: "Tom's",
        siteUrl: null,
        url: "https://t/a",
        title: "Fresh GPU story",
        excerpt: "x",
        author: null,
        publishedAt: "2026-07-04T11:00:00.000Z",
        thumbnailUrl: null,
      }],
      mutedTerms: [],
    },
    {
      id: 2,
      name: "AI",
      position: 1,
      sources: [{
        id: 20,
        topicId: 2,
        kind: "rss",
        title: "Dead Feed",
        feedUrl: "https://d/f",
        siteUrl: null,
        enabled: true,
        hnQuery: null,
        minPoints: null,
        lastStatus: "timeout",
        lastFetchAt: null,
        consecutiveFailures: 7,
      }],
      items: [],
      mutedTerms: [],
    },
  ],
};

const noop = () => {};

describe("NewsView", () => {
  it("keeps the topic index in sync with the section under the sticky toolbar", () => {
    const { container } = render(
      <div data-scroll-lock-target="">
        <NewsView
          news={payload}
          loading={false}
          error={null}
          refreshing={false}
          dividerMarker="2026-07-04T10:00:00.000Z"
          hideSeen={false}
          onToggleHideSeen={noop}
          onMarkAllSeen={noop}
          onRefresh={noop}
          onOpenManage={noop}
          onReload={noop}
        />
      </div>,
    );
    const scrollRegion = container.querySelector<HTMLElement>("[data-scroll-lock-target]")!;
    const hardwareSection = screen.getByRole("region", { name: "PC Hardware" });
    const aiSection = screen.getByRole("region", { name: "AI" });
    vi.spyOn(scrollRegion, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(hardwareSection, "getBoundingClientRect").mockReturnValue({ top: -140 } as DOMRect);
    vi.spyOn(aiSection, "getBoundingClientRect").mockReturnValue({ top: 10 } as DOMRect);

    fireEvent.scroll(scrollRegion);

    const index = screen.getByRole("navigation", { name: /news topics/i });
    expect(within(index).getByRole("link", { name: /AI.*feed needs attention/i }).getAttribute("aria-current"))
      .toBe("location");
    expect(within(index).getByRole("link", { name: /PC Hardware.*1 new/i }).hasAttribute("aria-current"))
      .toBe(false);
  });
});
