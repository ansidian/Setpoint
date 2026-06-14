// Minimal HTML → plain text for email previews and FTS indexing.
// Drops <style>/<script>/comment content (whose text would otherwise leak
// into snippet() results as CSS/JS noise), strips remaining tags, and decodes
// the handful of entities common in marketing mail. Real display-time
// sanitization happens in EmailReader via DOMPurify.
export function htmlToPlainText(input) {
  if (!input) return "";
  return String(input)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
