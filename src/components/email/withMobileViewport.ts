// Match an opening <head>/<html> tag, skipping '>' that appear inside quoted
// attribute values — DOMPurify does not entity-encode '>' inside attributes,
// so a naive [^>]* would splice the injected markup mid-attribute.
const HEAD_OPEN = /<head\b(?:"[^"]*"|'[^']*'|[^"'>])*>/i;
const HTML_OPEN = /<html\b(?:"[^"]*"|'[^']*'|[^"'>])*>/i;

// Prepend `headHtml` to the document's <head>, creating a <head> (and <html>
// wrapper, if needed) when absent. Shared by every post-sanitize head-injection
// pass (viewport reset, CSP meta) so each caller only supplies the markup it
// wants injected — the three-branch "does this doc have a head/html/neither"
// logic lives here once.
function injectIntoHead(docHtml: string, headHtml: string): string {
  if (HEAD_OPEN.test(docHtml)) {
    return docHtml.replace(HEAD_OPEN, (match: string) => match + headHtml);
  }
  if (HTML_OPEN.test(docHtml)) {
    return docHtml.replace(HTML_OPEN, (match: string) => `${match}<head>${headHtml}</head>`);
  }
  return `<head>${headHtml}</head>${docHtml}`;
}

// Inject a mobile viewport + minimal image/box reset into the iframe document so
// an HTML email lays out to the iframe width instead of overflowing. Runs AFTER
// DOMPurify (which would otherwise strip an injected <meta>): the meta lives in
// the document template, not the purified body. Pinch-zoom stays enabled (no
// maximum-scale), per the mobile-remake accessibility rule. Inject at the START
// of <head> so the reset acts as a default the email's own styles can override.
export function withMobileViewport(docHtml = ""): string {
  const head = '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>html,body{margin:0;padding:0;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}</style>';
  return injectIntoHead(docHtml, head);
}

// Inject a restrictive per-document CSP <meta> into the iframe document. Runs
// post-sanitize (a pre-sanitize <meta> would be stripped by DOMPurify — the meta
// lives in the document template, not the purified body) and must be applied
// LAST relative to any other head injection so it lands first in <head>: CSP is
// a "most restrictive wins" browser policy, so ours only needs to appear before
// conflicting metas, not literally first in the document. This blocks remote
// images/stylesheets/@import/CSS url() beacons regardless of the parent page's
// CSP, which in production allows `img-src`/`style-src https:` and in dev has no
// CSP at all — so without this, opening an email fetches attacker-controlled
// remote content (read-receipt/IP leak) on render. A sender-supplied CSP <meta>
// can only ever tighten the effective policy (CSPs intersect, never relax), and
// DOMPurify strips `http-equiv` from any sender markup during sanitization
// anyway, so there's no way for the email itself to weaken or duplicate this.
//
// `policy` defaults to the strict lockdown; EmailIframe's per-message
// "Show remote content" toggle passes REMOTE_IMAGES_ALLOWED_EMAIL_CSP_POLICY
// instead when the user has opted in for that one message.
export const STRICT_EMAIL_CSP_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
export const REMOTE_IMAGES_ALLOWED_EMAIL_CSP_POLICY = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'";

export function withEmailContentSecurityPolicy(docHtml = "", policy = STRICT_EMAIL_CSP_POLICY): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  return injectIntoHead(docHtml, head);
}
