import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NewsView from "./NewsView";
import type { NewsPageEnvelope } from "../../../shared/types/news.ts";

afterEach(cleanup);

const payload: NewsPageEnvelope = {
  lastSeenAt: "2026-07-04T10:00:00.000Z",
  lastUpdatedAt: "2026-07-04T11:55:00.000Z",
  topics: [
    {
      id: 1, name: "PC Hardware", position: 0, sources: [],
      items: [
        { id: 100, sourceId: 10, sourceTitle: "Tom's", siteUrl: null, url: "https://t/a", title: "Fresh GPU story",
          excerpt: "x", author: null, publishedAt: "2026-07-04T11:00:00.000Z", thumbnailUrl: null },
        { id: 101, sourceId: 10, sourceTitle: "Tom's", siteUrl: null, url: "https://t/b", title: "Old PSU story",
          excerpt: "x", author: null, publishedAt: "2026-07-04T08:00:00.000Z", thumbnailUrl: null },
      ], mutedTerms: [],
    },
    {
      id: 2, name: "AI", position: 1,
      sources: [{ id: 20, topicId: 2, kind: "rss", title: "Dead Feed", feedUrl: "https://d/f", siteUrl: null,
        enabled: true, hnQuery: null, minPoints: null, lastStatus: "timeout", lastFetchAt: null,
        consecutiveFailures: 7 }],
      items: [], mutedTerms: [],
    },
    {
      id: 3, name: "Cooking", position: 2, sources: [],
      items: [
        { id: 102, sourceId: 11, sourceTitle: "Serious Eats", siteUrl: null, url: "https://s/c", title: "Old stew story",
          excerpt: "x", author: null, publishedAt: "2026-07-04T07:00:00.000Z", thumbnailUrl: null },
      ], mutedTerms: [],
    },
  ],
};

const noop = () => {};

describe("NewsView", () => {
  it("summarizes the front page and exposes a topic index", () => {
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker="2026-07-04T10:00:00.000Z" hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByText("1 new · 3 topics")).toBeTruthy();
    const index = screen.getByRole("navigation", { name: /news topics/i });
    expect(within(index).getByRole("link", { name: /PC Hardware.*1 new/i })).toBeTruthy();
    expect(within(index).getByRole("link", { name: /Cooking.*caught up/i })).toBeTruthy();
  });

  it("keeps the topic index in sync with the section under the sticky toolbar", () => {
    const { container } = render(
      <div data-scroll-lock-target="">
        <NewsView news={payload} loading={false} error={null} refreshing={false}
          dividerMarker="2026-07-04T10:00:00.000Z" hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
          onRefresh={noop} onOpenManage={noop} onReload={noop} />
      </div>,
    );
    const scrollRegion = container.querySelector<HTMLElement>("[data-scroll-lock-target]")!;
    const hardwareSection = screen.getByRole("region", { name: "PC Hardware" });
    const aiSection = screen.getByRole("region", { name: "AI" });
    const cookingSection = screen.getByRole("region", { name: "Cooking" });
    vi.spyOn(scrollRegion, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(hardwareSection, "getBoundingClientRect").mockReturnValue({ top: -140 } as DOMRect);
    vi.spyOn(aiSection, "getBoundingClientRect").mockReturnValue({ top: 10 } as DOMRect);
    vi.spyOn(cookingSection, "getBoundingClientRect").mockReturnValue({ top: 320 } as DOMRect);

    fireEvent.scroll(scrollRegion);

    const index = screen.getByRole("navigation", { name: /news topics/i });
    expect(within(index).getByRole("link", { name: /AI.*feed needs attention/i }).getAttribute("aria-current"))
      .toBe("location");
    expect(within(index).getByRole("link", { name: /PC Hardware.*1 new/i }).hasAttribute("aria-current"))
      .toBe(false);
  });

  it("describes freshness as the last feed check", () => {
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker={null} hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByText(/^checked .* ago$/i)).toBeTruthy();
  });

  it("renders topic sections in order with items and a seen divider", () => {
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker="2026-07-04T10:00:00.000Z" hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(expect.arrayContaining(["PC Hardware", "AI"]));
    expect(screen.getByRole("link", { name: /Fresh GPU story/ })).toHaveProperty("target", "_blank");
    expect(screen.getByText(/^seen$/i)).toBeTruthy();
    expect(screen.getByText(/no stories yet/i)).toBeTruthy();
  });

  it("separates each topic's lead story from its compact headlines", () => {
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker="2026-07-04T10:00:00.000Z" hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    const hardware = screen.getByRole("region", { name: "PC Hardware" });
    const leadLane = within(hardware).getByRole("group", { name: /lead story/i });
    const headlineLane = within(hardware).getByRole("group", { name: /more headlines/i });
    expect(within(leadLane).getByRole("link", { name: /Fresh GPU story/i })).toBeTruthy();
    expect(within(headlineLane).getByRole("link", { name: /Old PSU story/i })).toBeTruthy();
  });

  it("shows the first-run empty state with a starter-topics action", () => {
    render(<NewsView news={{ lastSeenAt: null, lastUpdatedAt: null, topics: [] }} loading={false}
      error={null} refreshing={false} dividerMarker={null} hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByRole("button", { name: /add starter topics/i })).toBeTruthy();
  });

  it("shows a retry state on load error", () => {
    render(<NewsView news={null} loading={false} error={new Error("boom")} refreshing={false}
      dividerMarker={null} hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("New view hides older rows and gives quiet topics a caught-up state", () => {
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker="2026-07-04T10:00:00.000Z" hideSeen onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByRole("link", { name: /Fresh GPU story/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Old PSU story/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Old stew story/ })).toBeNull();
    expect(screen.queryByText(/^seen$/i)).toBeNull();
    const cooking = screen.getByRole("region", { name: "Cooking" });
    expect(within(cooking).getByText(/^caught up$/i)).toBeTruthy();
  });

  it("switches between All and New story views", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker={null} hideSeen={false} onToggleHideSeen={onToggle} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    const allButton = screen.getByRole("button", { name: /^all$/i });
    const newButton = screen.getByRole("button", { name: /^new$/i });
    expect(allButton.getAttribute("aria-pressed")).toBe("true");
    expect(newButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(newButton);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker={null} hideSeen onToggleHideSeen={onToggle} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByRole("button", { name: /^new$/i }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("marks the page caught up from the toolbar", () => {
    const onMarkAllSeen = vi.fn();
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker={null} hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={onMarkAllSeen}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /mark caught up/i }));
    expect(onMarkAllSeen).toHaveBeenCalledTimes(1);
  });

  it("opens source management from the Sources action", () => {
    const onOpenManage = vi.fn();
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker={null} hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={onOpenManage} onReload={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /^sources$/i }));
    expect(onOpenManage).toHaveBeenCalledWith();
  });

  it("opens the affected topic when a feed needs attention", () => {
    const onOpenManage = vi.fn();
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker={null} hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={onOpenManage} onReload={noop} />);
    const health = screen.getByRole("button", { name: /1 feed needs attention/i });
    fireEvent.click(health);
    expect(onOpenManage).toHaveBeenCalledWith(2);
    expect(screen.queryByText(/source(s)? failing/i)).toBeNull();
  });
});
