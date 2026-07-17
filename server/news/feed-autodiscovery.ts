// server/news/feed-autodiscovery.js
// Pure string parsing: find advertised feeds in an HTML <head>. Regex over
// <link> tags is deliberate — no DOM dependency server-side, and the tags we
// need are machine-written one-liners.

const LINK_TAG = /<link\b[^>]*>/gi;
const FEED_TYPE = /application\/(rss|atom)\+xml|application\/feed\+json/i;

export interface DiscoveredFeed {
  url: string;
  title: string | null;
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[2] ?? match[3] ?? null) : null;
}

export function discoverFeedUrls(html: unknown, baseUrl: string): DiscoveredFeed[] {
  const found: DiscoveredFeed[] = [];
  for (const tag of String(html || "").match(LINK_TAG) || []) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    if (!rel.split(/\s+/).includes("alternate")) continue;
    if (!FEED_TYPE.test(attr(tag, "type") || "")) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    try {
      found.push({ url: new URL(href, baseUrl).toString(), title: attr(tag, "title") || null });
    } catch {
      // unresolvable href — skip
    }
  }
  return found;
}

export function looksLikeFeed(body: unknown, contentType = ""): boolean {
  if (/(rss|atom)\+xml|text\/xml|application\/xml|application\/feed\+json/i.test(contentType)) return true;
  const head = String(body || "").slice(0, 512).trimStart();
  return /^<\?xml/.test(head) || /^<rss\b/.test(head) || /^<feed\b/.test(head)
    || (/^<\?xml[^>]*\?>\s*<(rss|feed)\b/.test(head));
}
