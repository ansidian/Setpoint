// server/news/news-preview.js
// Add-source validation: fetch what the owner pasted; if it's a feed, sample
// it; if it's HTML, follow the advertised <link rel=alternate> once.
import { discoverFeedUrls, looksLikeFeed } from "./feed-autodiscovery.js";
import { fetchFeedResponse, parseFeedXml } from "./news-poller.js";

async function fetchForPreview(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "SetpointNews/1.0 (personal dashboard; single user)" },
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body: response.status === 200 ? await response.text() : "",
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sampleFeed(xml, feedUrl) {
  const feed = await parseFeedXml(xml);
  return {
    feedUrl,
    title: feed.title || feedUrl,
    sampleTitles: (feed.items || []).slice(0, 3).map((item) => item.title || "").filter(Boolean),
  };
}

export async function previewNewsFeed(url, { fetchImpl = fetch } = {}) {
  const first = await fetchForPreview(url, fetchImpl);
  if (first.status !== 200) return null;
  if (looksLikeFeed(first.body, first.contentType)) {
    try {
      return await sampleFeed(first.body, first.finalUrl);
    } catch {
      return null;
    }
  }
  const [advertised] = discoverFeedUrls(first.body, first.finalUrl);
  if (!advertised) return null;
  const second = await fetchFeedResponse(advertised.url, { fetchImpl });
  if (second.status !== 200) return null;
  try {
    return await sampleFeed(second.body, second.finalUrl || advertised.url);
  } catch {
    return null;
  }
}
