// Inject a mobile viewport + minimal image/box reset into the iframe document so
// an HTML email lays out to the iframe width instead of overflowing. Runs AFTER
// DOMPurify (which would otherwise strip an injected <meta>): the meta lives in
// the document template, not the purified body. Pinch-zoom stays enabled (no
// maximum-scale), per the mobile-remake accessibility rule.
export function withMobileViewport(docHtml = "") {
  const head = '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>html,body{margin:0;padding:0}img{max-width:100%;height:auto}</style>';
  // Match an opening <head>/<html> tag, skipping '>' that appear inside quoted
  // attribute values — DOMPurify does not entity-encode '>' inside attributes,
  // so a naive [^>]* would splice the meta mid-attribute. Inject at the START of
  // <head> so the reset acts as a default the email's own styles can override.
  const headOpen = /<head\b(?:"[^"]*"|'[^']*'|[^"'>])*>/i;
  const htmlOpen = /<html\b(?:"[^"]*"|'[^']*'|[^"'>])*>/i;
  if (headOpen.test(docHtml)) {
    return docHtml.replace(headOpen, (match) => match + head);
  }
  if (htmlOpen.test(docHtml)) {
    return docHtml.replace(htmlOpen, (match) => `${match}<head>${head}</head>`);
  }
  return `<head>${head}</head>${docHtml}`;
}
