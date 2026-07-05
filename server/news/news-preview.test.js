// server/news/news-preview.test.js
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { previewNewsFeed } from "./news-preview.js";

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>TechPowerUp Frontpage News</title>
  <item><title>First story</title><link>https://tpu/a</link></item>
  <item><title>Second story</title><link>https://tpu/b</link></item>
</channel></rss>`;

function response({ status = 200, body = "", contentType = "text/html", url = "" }) {
  return {
    status, url,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}

describe("previewNewsFeed", () => {
  it("returns title + samples when the URL is itself a feed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ body: FEED, contentType: "application/rss+xml", url: "https://tpu/rss/news" }),
    );
    expect(await previewNewsFeed("https://tpu/rss/news", { fetchImpl })).toEqual({
      feedUrl: "https://tpu/rss/news",
      title: "TechPowerUp Frontpage News",
      sampleTitles: ["First story", "Second story"],
    });
  });

  it("autodiscovers from an HTML page and fetches the advertised feed", async () => {
    const html = `<html><head><link rel="alternate" type="application/rss+xml" href="/rss/news"></head></html>`;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ body: html, contentType: "text/html", url: "https://www.techpowerup.com/" }))
      .mockResolvedValueOnce(response({ body: FEED, contentType: "application/rss+xml", url: "https://www.techpowerup.com/rss/news" }));
    const preview = await previewNewsFeed("https://www.techpowerup.com/", { fetchImpl });
    expect(preview.feedUrl).toBe("https://www.techpowerup.com/rss/news");
    expect(preview.title).toBe("TechPowerUp Frontpage News");
  });

  it("returns null when the page is HTML with no advertised feed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ body: "<html><head></head></html>", contentType: "text/html" }),
    );
    expect(await previewNewsFeed("https://nofeeds.example", { fetchImpl })).toBeNull();
  });
});
