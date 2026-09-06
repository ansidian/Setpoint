// Presentation is injected into the already-sanitized document. The source DOM,
// its styles, URLs and visibility rules stay intact: zero-size preheaders and
// layout tables must not become content extraction casualties.
const READING_STYLES = `
html { overflow-wrap: anywhere; }
body { margin: 0 !important; padding: 24px !important; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.8; }
body :where(p, div, span, caption, td, th, li, a, h1, h2, h3, h4, h5, h6, blockquote) { font-family: system-ui, sans-serif !important; }
body :where(pre, code, kbd, samp), body :where(pre, code, kbd, samp) * { font-family: ui-monospace, monospace !important; }
img { max-width: 100%; object-fit: contain; }
@media (max-width: 480px) { body { padding: 16px !important; } }
`;

// Add/remove only our stylesheet in the existing document. Formatting switches
// must not navigate the iframe or refetch remote images already allowed there.
export function applyEmailReadingPresentation(doc: Document): () => void {
  const style = doc.createElement("style");
  style.setAttribute("data-setpoint-reading", "");
  style.textContent = READING_STYLES;
  doc.head.prepend(style);
  return () => style.remove();
}
