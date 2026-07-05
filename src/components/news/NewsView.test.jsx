import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    { id: 2, name: "AI", position: 1, sources: [], items: [] },
  ],
};

const noop = () => {};

describe("NewsView", () => {
  it("renders topic sections in order with items and a seen divider", () => {
    render(<NewsView news={payload} loading={false} error={null} refreshing={false}
      dividerMarker="2026-07-04T10:00:00.000Z" onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(expect.arrayContaining(["PC Hardware", "AI"]));
    expect(screen.getByRole("link", { name: /Fresh GPU story/ })).toHaveProperty("target", "_blank");
    expect(screen.getByText(/seen/i)).toBeTruthy();
    expect(screen.getByText(/no stories yet/i)).toBeTruthy();
  });

  it("shows the first-run empty state with a starter-topics action", () => {
    render(<NewsView news={{ lastSeenAt: null, lastUpdatedAt: null, topics: [] }} loading={false}
      error={null} refreshing={false} dividerMarker={null}
      onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByRole("button", { name: /add starter topics/i })).toBeTruthy();
  });

  it("shows a retry state on load error", () => {
    render(<NewsView news={null} loading={false} error={new Error("boom")} refreshing={false}
      dividerMarker={null} onRefresh={noop} onOpenManage={noop} onReload={noop} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
