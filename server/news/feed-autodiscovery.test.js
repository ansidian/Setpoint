// server/news/feed-autodiscovery.test.js
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { discoverFeedUrls, looksLikeFeed } from "./feed-autodiscovery.js";

describe("discoverFeedUrls", () => {
  it("finds rss and atom alternates and resolves relative hrefs", () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="TechPowerUp Frontpage News" href="/rss/news">
      <link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
      <link rel="stylesheet" href="/style.css">
      <link rel="alternate" type="text/html" href="/mobile">
    </head><body></body></html>`;
    expect(discoverFeedUrls(html, "https://www.techpowerup.com/")).toEqual([
      { url: "https://www.techpowerup.com/rss/news", title: "TechPowerUp Frontpage News" },
      { url: "https://example.com/atom.xml", title: null },
    ]);
  });
  it("handles single-quoted attributes and returns [] when none", () => {
    expect(discoverFeedUrls("<link rel='alternate' type='application/rss+xml' href='/f'>", "https://a.com"))
      .toEqual([{ url: "https://a.com/f", title: null }]);
    expect(discoverFeedUrls("<html><head></head></html>", "https://a.com")).toEqual([]);
  });
});

describe("looksLikeFeed", () => {
  it("accepts xml content types and feed-shaped bodies", () => {
    expect(looksLikeFeed("", "application/rss+xml; charset=utf-8")).toBe(true);
    expect(looksLikeFeed('<?xml version="1.0"?><rss version="2.0">', "text/html")).toBe(true);
    expect(looksLikeFeed('<feed xmlns="http://www.w3.org/2005/Atom">', "")).toBe(true);
  });
  it("rejects plain html", () => {
    expect(looksLikeFeed("<!doctype html><html>", "text/html")).toBe(false);
  });
});
