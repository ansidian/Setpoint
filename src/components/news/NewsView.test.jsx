import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NewsView from "./NewsView.jsx";

afterEach(cleanup);

const payload = {
  lastSeenAt: "2026-07-04T10:00:00.000Z",
  lastUpdatedAt: "2026-07-04T11:55:00.000Z",
  topics: [
    {
      id: 1, name: "PC Hardware", position: 0, sources: [],
      items: [
        { id: 100, sourceId: 10, sourceTitle: "Tom's", url: "https://t/a", title: "Fresh GPU story",
          excerpt: "x", author: null, publishedAt: "2026-07-04T11:00:00.000Z", thumbnailUrl: null },
        { id: 101, sourceId: 10, sourceTitle: "Tom's", url: "https://t/b", title: "Old PSU story",
          excerpt: "x", author: null, publishedAt: "2026-07-04T08:00:00.000Z", thumbnailUrl: null },
      ],
    },
    {
      id: 2, name: "AI", position: 1,
      sources: [{ id: 20, topicId: 2, kind: "rss", title: "Dead Feed", feedUrl: "https://d/f", siteUrl: null,
        enabled: true, hnQuery: null, minPoints: null, lastStatus: "timeout", lastFetchAt: null,
        consecutiveFailures: 7 }],
      items: [],
    },
    {
      id: 3, name: "Cooking", position: 2, sources: [],
      items: [
        { id: 102, sourceId: 11, sourceTitle: "Serious Eats", url: "https://s/c", title: "Old stew story",
          excerpt: "x", author: null, publishedAt: "2026-07-04T07:00:00.000Z", thumbnailUrl: null },
      ],
    },
  ],
};

const noop = () => {};

describe("NewsView", () => {
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

  it("hideSeen hides older rows and the divider; quiet topics become a Nothing-new stub", () => {
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker="2026-07-04T10:00:00.000Z" hideSeen onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByRole("link", { name: /Fresh GPU story/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Old PSU story/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Old stew story/ })).toBeNull();
    expect(screen.queryByText(/^seen$/i)).toBeNull();
    expect(screen.getByText(/nothing new/i)).toBeTruthy();
  });

  it("exposes a New-only toggle reflecting pressed state", () => {
    const onToggle = vi.fn();
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker={null} hideSeen={false} onToggleHideSeen={onToggle} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    const toggle = screen.getByRole("button", { name: /new only/i });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalled();
  });

  it("flags a topic whose source is failing; healthy topics stay clean", () => {
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker={null} hideSeen={false} onToggleHideSeen={noop} onMarkAllSeen={noop}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByText(/1 source failing/i)).toBeTruthy();
    expect(screen.getAllByText(/source(s)? failing/i)).toHaveLength(1); // only the AI topic
  });
});
