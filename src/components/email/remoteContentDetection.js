// Detects whether a sanitized email body contains a remote HTTPS <img>
// reference, so EmailIframe can decide whether to offer a "Show remote
// content" toggle. Only <img src="https://..."> counts — this gates a UI
// affordance, not the CSP itself. Deliberately https-only, matching the
// widened CSP's `img-src data: https:` (never `http:`): the banner must
// only promise to unblock content that clicking it can actually unblock,
// and this repo does not allowlist cleartext image fetches.
const REMOTE_HTTPS_IMG_SRC = /<img\b[^>]*\bsrc\s*=\s*["']https:\/\//i;

export function hasRemoteImageRefs(sanitizedHtml = "") {
  return REMOTE_HTTPS_IMG_SRC.test(sanitizedHtml);
}
