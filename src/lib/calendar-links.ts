const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
const BARE_URL_RE = /(?<![A-Za-z0-9@:/._-])(?:www\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(?:\/[^\s<>"'`]*)?/gi;
const TRAILING_PUNCTUATION_RE = /[),.;!?]+$/;
const ZOOM_HOST_SUFFIXES = ["zoom.us", "zoom.com", "zoomgov.com"];

export interface CalendarLinkFields {
  location?: unknown;
  description?: unknown;
  notes?: unknown;
}

function decodeHtmlEntities(value: unknown): string {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function stripTrailingPunctuation(value: unknown): string {
  let next = decodeHtmlEntities(value).trim();
  while (TRAILING_PUNCTUATION_RE.test(next)) {
    next = next.replace(TRAILING_PUNCTUATION_RE, "");
  }
  return next;
}

function normalizeEventUrl(rawUrl: unknown): string | null {
  const stripped = stripTrailingPunctuation(rawUrl);
  if (!stripped) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(stripped)
    ? stripped
    : `https://${stripped}`;

  try {
    const url = new URL(withScheme);
    const host = url.hostname.toLowerCase();
    const googleRedirectTarget = host === "www.google.com" || host === "google.com"
      ? url.searchParams.get("q") || url.searchParams.get("url")
      : null;

    if (googleRedirectTarget) {
      return normalizeEventUrl(googleRedirectTarget);
    }

    return url.toString();
  } catch {
    return stripped;
  }
}

function extractBareUrlsFromText(text: string): string[] {
  const trimmedText = stripTrailingPunctuation(text);
  return [...text.matchAll(BARE_URL_RE)]
    .map((match) => stripTrailingPunctuation(match[0]))
    .filter((candidate) => {
      if (!candidate) return false;
      if (candidate.toLowerCase().startsWith("www.")) return true;
      if (candidate.includes("/")) return true;
      return candidate === trimmedText;
    });
}

function isGoogleCalendarUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return host === "calendar.google.com"
      || host.endsWith(".calendar.google.com")
      || ((host === "google.com" || host.endsWith(".google.com")) && url.pathname === "/calendar/event");
  } catch {
    return false;
  }
}

export function extractUrlsFromText(text: unknown): string[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const decoded = decodeHtmlEntities(text);
  const urls = [
    ...[...decoded.matchAll(HREF_RE)].map((match) => match[1] || match[2] || match[3]),
    ...[...decoded.matchAll(URL_RE)].map((match) => match[0]),
    ...extractBareUrlsFromText(decoded),
  ];
  const seen = new Set();
  return urls
    .map((url) => normalizeEventUrl(url))
    .filter((url): url is string => url !== null)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

export function stripUrlsFromText(text: unknown): string {
  if (typeof text !== "string" || !text.trim()) return "";
  return decodeHtmlEntities(text)
    .replace(HREF_RE, " ")
    .replace(URL_RE, " ")
    .replace(BARE_URL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isZoomUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return ZOOM_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

export function extractZoomMeetingUrl(event: CalendarLinkFields | null | undefined): string | null {
  const candidates = [
    event?.location,
    event?.description,
    event?.notes,
  ];

  for (const text of candidates) {
    for (const url of extractUrlsFromText(text)) {
      if (isZoomUrl(url)) return url;
    }
  }

  return null;
}

export function extractNonZoomEventUrl(event: CalendarLinkFields | null | undefined): string | null {
  const candidates = [
    event?.location,
    event?.description,
    event?.notes,
  ];

  for (const text of candidates) {
    for (const url of extractUrlsFromText(text)) {
      if (!isZoomUrl(url) && !isGoogleCalendarUrl(url)) return url;
    }
  }

  return null;
}

export function getLocationDisplayLabel(text: unknown): string {
  if (typeof text !== "string" || !text.trim()) return "";

  const zoomUrl = extractZoomMeetingUrl({ location: text });
  if (!zoomUrl) return text;

  const stripped = stripUrlsFromText(text);
  if (stripped) return stripped;
  return "Zoom meeting";
}
