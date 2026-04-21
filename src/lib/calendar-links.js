const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION_RE = /[),.;!?]+$/;
const ZOOM_HOST_SUFFIXES = ["zoom.us", "zoom.com", "zoomgov.com"];

function stripTrailingPunctuation(value) {
  let next = String(value || "").trim();
  while (TRAILING_PUNCTUATION_RE.test(next)) {
    next = next.replace(TRAILING_PUNCTUATION_RE, "");
  }
  return next;
}

export function extractUrlsFromText(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  return [...text.matchAll(URL_RE)]
    .map((match) => stripTrailingPunctuation(match[0]))
    .filter(Boolean);
}

export function stripUrlsFromText(text) {
  if (typeof text !== "string" || !text.trim()) return "";
  return text
    .replace(URL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isZoomUrl(rawUrl) {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return ZOOM_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

export function extractZoomMeetingUrl(event) {
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

export function getLocationDisplayLabel(text) {
  if (typeof text !== "string" || !text.trim()) return "";

  const zoomUrl = extractZoomMeetingUrl({ location: text });
  if (!zoomUrl) return text;

  const stripped = stripUrlsFromText(text);
  if (stripped) return stripped;
  return "Zoom meeting";
}
